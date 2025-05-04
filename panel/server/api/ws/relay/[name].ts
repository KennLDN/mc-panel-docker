import { defineEventHandler, H3Event, createError } from 'h3';
import { WebSocketServer, WebSocket } from 'ws';
import { useStorage } from '#imports'; // Use #imports for Nitro auto-imports
import type { DiscoveredService } from '~/server/utils/mdnsUtils';
import http from 'http';

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
  console.log('WebSocketServer initialized for relay.');

  httpServerRef.on('upgrade', async (request, socket, head) => {
    console.log('[UPGRADE LISTENER] Triggered.');
    try {
      // Ensure wssInstance is available (should be after initialization)
      if (!wssInstance) {
        console.error('[UPGRADE LISTENER] WSS instance not available during upgrade.');
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
          console.error('Could not extract service name from upgrade request path:', pathname);
          socket.write('HTTP/1.1 400 Bad Request\\r\\nContent-Type: text/plain\\r\\nConnection: close\\r\\n\\r\\nService name missing in path\\r\\n');
          socket.destroy();
          return;
      }

      console.log(`Handling upgrade request for service: ${serviceName}`);

      // --- Fetch target service details within the upgrade handler ---
      const storage = useStorage(STORAGE_BASE);
      const currentServices = (await storage.getItem(STORAGE_KEY)) as DiscoveredService[] || [];
      const targetService = currentServices.find(s => s.name === serviceName);

      if (!targetService) {
        console.error(`Service '${serviceName}' not found for WebSocket relay during upgrade.`);
        // Respond with HTTP error before destroying socket
        socket.write(`HTTP/1.1 404 Not Found\\r\\nContent-Type: text/plain\\r\\nConnection: close\\r\\n\\r\\nService '${serviceName}' not found\\r\\n`);
        socket.destroy();
        return;
      }

      const targetWsUrl = `ws://${targetService.address}:8080/`;
      console.log(`Target WebSocket URL for ${serviceName}: ${targetWsUrl}`);

      // --- Handle the upgrade ---
      wssInstance.handleUpgrade(request, socket, head, (frontendWs) => {
        console.log(`Frontend WebSocket connected for service: ${serviceName}`);
        // Emit connection event for potential external handling if needed
        // wssInstance?.emit('connection', frontendWs, request);

        // Establish connection to the target internal WebSocket server
        let targetWs: WebSocket | null = null;
        try {
            targetWs = new WebSocket(targetWsUrl);
        } catch (err) {
            console.error(`Failed to connect to target WebSocket ${targetWsUrl}:`, err);
            frontendWs.close(1011, 'Failed to connect to target service');
            return;
        }

        // --- Relay Logic ---

        targetWs.on('open', () => {
          console.log(`Backend connection to target WebSocket ${targetWsUrl} opened.`);
        });

        // Message from target server -> Frontend
        targetWs.on('message', (message, isBinary) => { // Capture isBinary
          if (frontendWs.readyState === WebSocket.OPEN) {
            // console.log(`Relaying message from target ${serviceName} to frontend:`, message.toString());
            frontendWs.send(message, { binary: isBinary }); // Preserve binary status
          } else {
            console.log('Frontend WS closed, cannot relay message from target.');
            targetWs?.close();
          }
        });

        // Message from Frontend -> Target server
        frontendWs.on('message', (message, isBinary) => { // Capture isBinary
          if (targetWs?.readyState === WebSocket.OPEN) {
            // console.log(`Relaying message from frontend to target ${serviceName}:`, message.toString());
            targetWs.send(message, { binary: isBinary }); // Preserve binary status
          } else {
            console.log('Target WS closed, cannot relay message from frontend.');
            frontendWs.close(1011, 'Target service connection lost');
          }
        });

        // --- Handle closures and errors ---

        targetWs.on('close', (code, reason) => {
          const reasonStr = reason?.toString();
          console.log(`Target WebSocket ${targetWsUrl} closed:`, code, reasonStr);
          if (frontendWs.readyState === WebSocket.OPEN) {
            frontendWs.close(1011, `Target service closed: ${reasonStr || code}`);
          }
        });

        targetWs.on('error', (error) => {
          console.error(`Target WebSocket ${targetWsUrl} error:`, error);
          if (frontendWs.readyState === WebSocket.OPEN) {
            frontendWs.close(1011, `Target service error: ${error.message}`);
          }
        });

        frontendWs.on('close', (code, reason) => {
          const reasonStr = reason?.toString();
          console.log(`Frontend WebSocket for ${serviceName} closed:`, code, reasonStr);
          if (targetWs?.readyState === WebSocket.OPEN || targetWs?.readyState === WebSocket.CONNECTING) {
            targetWs.close();
          }
          targetWs = null;
        });

        frontendWs.on('error', (error) => {
          console.error(`Frontend WebSocket for ${serviceName} error:`, error);
          if (targetWs?.readyState === WebSocket.OPEN || targetWs?.readyState === WebSocket.CONNECTING) {
            targetWs.close();
          }
          targetWs = null;
        });
      });
    } catch (error) {
      console.error('[UPGRADE LISTENER] Unhandled error in upgrade listener:', error);
      // Ensure the socket is destroyed if an error occurs before/during handleUpgrade
      if (socket && !socket.destroyed) {
        console.error('[UPGRADE LISTENER] Destroying socket due to error.');
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
    console.error('Could not get HTTP server instance to initialize WebSocketServer.');
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
    console.log(`Upgrade request detected for ${event.node.req.url}, allowing upgrade listener to handle.`);
     // Setting statusCode hints to H3 this connection is being taken over.
     event.node.res.statusCode = 101; 
     // No return value here allows the connection to persist for the upgrade handler.

  } else {
    // --- Handle non-upgrade requests (e.g., accessing the path via GET normally) ---
    // It's unusual to access a WS endpoint with GET, but we can respond appropriately.
    console.log(`Non-upgrade request received for ${event.node.req.url}`);
    throw createError({ statusCode: 426, statusMessage: 'Upgrade Required' }); // 426 Upgrade Required is more specific
  }

  // Note: No explicit `return` for upgrade requests. For non-upgrade, error is thrown.
}); 