import { defineEventHandler, H3Event, createError } from 'h3';
import { WebSocketServer, WebSocket } from 'ws';
import { useStorage } from '#imports'; // Use #imports for Nitro auto-imports
import type { DiscoveredService } from '~/server/utils/mdnsUtils';
import http from 'http';
// Import the new manager
import {
  hasActiveTargetConnection, // Check if connection exists/connecting
  getOpenTargetWebSocket, // Get the WebSocket object if it's OPEN
  initializeTargetConnection, // To potentially re-init if needed
  addFrontendClient,
  removeFrontendClient,
  sendMessageToTarget
} from '~/server/utils/persistentWsManager';

const STORAGE_KEY = 'discovered';
const STORAGE_BASE = 'minecraft_services';

// Store WebSocketServer instance globally (for single-instance Nitro server)
let wssInstance: WebSocketServer | null = null;
let httpServerRef: http.Server | null = null; // Keep a reference to the http server

// Function to initialize WSS and attach the upgrade listener
// This ensures it only runs once per server instance.
const initializeWebSocketServer = (server: http.Server) => {
  if (wssInstance) return; // Already initialized

  httpServerRef = server;
  wssInstance = new WebSocketServer({ noServer: true });
  console.log('[Relay] WebSocketServer initialized for relay.');

  httpServerRef.on('upgrade', async (request, socket, head) => {
    console.log('[Relay Upgrade Listener] Triggered.');
    try {
      // Ensure wssInstance is available (should be after initialization)
      if (!wssInstance) {
        console.error('[Relay Upgrade Listener] WSS instance not available.');
        socket.destroy();
        return;
      }

      const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : undefined;
      const expectedPathPrefix = '/api/ws/relay/';

      if (!pathname?.startsWith(expectedPathPrefix)) {
        // This upgrade is not for us (might be for Vite HMR or other WS endpoints)
        // Do not destroy the socket here, let other handlers manage it.
        // console.log(`Upgrade request for ${pathname} ignored by relay.`);
        return;
      }

      // Extract service name from the path
      const serviceName = decodeURIComponent(pathname.substring(expectedPathPrefix.length));
      if (!serviceName) {
          console.error('[Relay] Could not extract service name from upgrade path:', pathname);
          socket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nService name missing in path\r\n');
          socket.destroy();
          return;
      }

      console.log(`[Relay] Handling upgrade request for service: ${serviceName}`);

      // --- Get target service details (still needed to confirm existence and potentially re-init) ---
      const storage = useStorage(STORAGE_BASE);
      const currentServices = (await storage.getItem(STORAGE_KEY)) as DiscoveredService[] || [];
      const targetService = currentServices.find(s => s.name === serviceName);

      if (!targetService) {
        console.error(`[Relay] Service '${serviceName}' not found in storage during upgrade.`);
        // Respond with HTTP error before destroying socket
        socket.write(`HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nService '${serviceName}' not found\r\n`);
        socket.destroy();
        return;
      }

      // --- Check if the persistent target connection is active or being established by the manager ---
      if (!hasActiveTargetConnection(serviceName)) {
          // Connection doesn't exist or isn't connecting. Try to initialize it.
          // This covers cases where the service might have just appeared or the initial connection failed.
          console.warn(`[Relay] No active connection found for ${serviceName}. Attempting initialization.`);
          initializeTargetConnection(targetService);
          // Even after initialization, the connection might take time. 
          // We could wait briefly or inform the client they need to retry.
          // For simplicity, let's reject the upgrade for now if it wasn't already connecting.
          console.error(`[Relay] Connection for '${serviceName}' was not ready. Rejecting upgrade.`);
          socket.write(`HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nTarget service '${serviceName}' connection not ready, please retry shortly.\r\n`);
          socket.destroy();
          return;
      }

      // Connection exists (or is connecting), proceed with frontend upgrade

      // --- Handle the frontend upgrade ---
      wssInstance.handleUpgrade(request, socket, head, (frontendWs) => {
        console.log(`[Relay] Frontend WebSocket connected for service: ${serviceName}. Associating with manager.`);

        // Check the target WebSocket *state* just before associating
        const targetWs = getOpenTargetWebSocket(serviceName); // Check if OPEN

        if (!targetWs) {
            // It might be connecting, or it might have closed between the check above and now.
            console.warn(`[Relay] Target WS for ${serviceName} is not OPEN during handleUpgrade. Closing frontend.`);
            frontendWs.close(1011, `Target service '${serviceName}' is not available or still connecting.`);
            return; // Don't associate client
        }

        // Target WS is confirmed OPEN, proceed.
        addFrontendClient(serviceName, frontendWs);

        // --- Relay Logic (Simplified) ---

        // Message from Frontend -> Target server (via Manager)
        frontendWs.on('message', (message, isBinary) => {
          // Send message through the manager to the shared targetWs
          sendMessageToTarget(serviceName, message as Buffer | string, isBinary);
        });

        // Message from target server -> Frontend is handled by the manager's broadcast logic

        // --- Handle frontend closures and errors ---

        frontendWs.on('close', (code, reason) => {
          const reasonStr = reason?.toString();
          console.log(`[Relay] Frontend WebSocket for ${serviceName} closed:`, code, reasonStr);
          // Unregister this client from the manager
          removeFrontendClient(serviceName, frontendWs);
        });

        frontendWs.on('error', (error) => {
          console.error(`[Relay] Frontend WebSocket for ${serviceName} error:`, error);
           // Unregister this client from the manager upon error too
          removeFrontendClient(serviceName, frontendWs);
           // Ensure the frontend socket is closed if the error didn't cause it
           if (frontendWs.readyState !== WebSocket.CLOSED && frontendWs.readyState !== WebSocket.CLOSING) {
               frontendWs.close(1011, `Frontend error: ${error.message}`);
           }
        });
      });
    } catch (error) {
      console.error('[Relay Upgrade Listener] Unhandled error:', error);
      // Ensure the socket is destroyed if an error occurs before/during handleUpgrade
      if (socket && !socket.destroyed) {
        console.error('[Relay Upgrade Listener] Destroying socket due to error.');
        socket.destroy();
      }
    }
  }); // End httpServer.on('upgrade')
};

export default defineEventHandler(async (event) => {
  // Attempt to get the HTTP server and initialize WSS + upgrade listener ONCE
  // This relies on the underlying server being available via event.node.req.socket.server
  // This might be specific to the Node server adapter for Nitro.
  const socket: any = event.node.req.socket;
  const currentHttpServer = socket?.server as http.Server | undefined;

  if (currentHttpServer && !wssInstance) {
    initializeWebSocketServer(currentHttpServer);
  } else if (!wssInstance) {
    // If we still don't have a WSS instance (e.g., server unavailable), error out.
    console.error('[Relay] Could not get HTTP server instance to initialize WebSocketServer.');
    // Note: Returning an error here might prevent the upgrade listener from ever attaching
    // if the first request fails. Consider logging and allowing the request to proceed
    // hoping a later request succeeds in initializing. For now, let's throw.
    throw createError({ statusCode: 503, statusMessage: 'WebSocket relay service not available (server setup)' });
  }

  // Check if it's an upgrade request
  const isUpgrade = event.node.req.headers['upgrade']?.toLowerCase() === 'websocket';

  if (isUpgrade) {
    // --- Let the global `upgrade` listener handle it ---
    // We must end the response here to signal that the connection is being hijacked
    // for the WebSocket protocol. Without this, the client might hang or error.
    // event.node.res.end(); // H3 might handle this automatically when hijacking? Let's be explicit.
    // UPDATE: According to H3 docs/behavior, explicitly calling .end() can interfere.
    // The upgrade handler (or H3 itself) should manage the socket lifecycle.
    // We simply do *not* return a standard HTTP response body for upgrade requests.
    console.log(`[Relay] Upgrade request detected for ${event.node.req.url}, allowing upgrade listener to handle.`);
     // Setting statusCode hints to H3 this connection is being taken over.
     event.node.res.statusCode = 101; 
     // No return value here allows the connection to persist for the upgrade handler.

  } else {
    // --- Handle non-upgrade requests (e.g., accessing the path via GET normally) ---
    // It's unusual to access a WS endpoint with GET, but we can respond appropriately.
    console.log(`[Relay] Non-upgrade request received for ${event.node.req.url}`);
    throw createError({ statusCode: 426, statusMessage: 'Upgrade Required' }); // 426 Upgrade Required is more specific
  }

  // Note: No explicit `return` for upgrade requests. For non-upgrade, error is thrown.
}); 