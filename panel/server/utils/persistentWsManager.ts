import { WebSocket } from 'ws';
import type { DiscoveredService } from '~/server/utils/mdnsUtils'; // Assuming this type exists
import { interceptMessage } from './messageInterceptor'; // <-- Import the interceptor

// --- Constants for Reconnection ---
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const RECONNECT_BACKOFF_FACTOR = 2;
const MAX_RECONNECT_ATTEMPTS = 10; // Stop trying after this many attempts

// --- Enhanced Connection State ---
interface TargetConnectionState {
  ws: WebSocket | null;
  service: DiscoveredService;
  targetWsUrl: string;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  isClosingIntentionally: boolean; // Flag to prevent reconnect on manual close
}

// Store connection state by service name
const targetConnections = new Map<string, TargetConnectionState>();
const frontendClients = new Map<string, Set<WebSocket>>();

// --- Reconnection Logic ---
const scheduleReconnect = (serviceName: string) => {
  const state = targetConnections.get(serviceName);
  if (!state || state.isClosingIntentionally || state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (state && state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn(`[Manager] Max reconnect attempts reached for ${serviceName}. Giving up.`);
        // Ensure cleanup if we give up
        targetConnections.delete(serviceName);
        closeAssociatedFrontendClients(serviceName, 1011, `Target service ${serviceName} unreachable after multiple retries`);
    }
    return; // Don't schedule if closing, state missing, or max attempts reached
  }

  // Calculate delay with exponential backoff
  let delay = INITIAL_RECONNECT_DELAY * Math.pow(RECONNECT_BACKOFF_FACTOR, state.reconnectAttempts);
  delay = Math.min(delay, MAX_RECONNECT_DELAY); // Cap the delay
  // Add some jitter (e.g., +/- 10%) to prevent thundering herd
  delay = delay * (0.9 + Math.random() * 0.2);

  state.reconnectAttempts++;
  console.log(`[Manager] Scheduling reconnect attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for ${serviceName} in ${Math.round(delay / 1000)}s...`);

  // Clear existing timer just in case
  if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
  }

  state.reconnectTimer = setTimeout(() => {
    console.log(`[Manager] Attempting reconnect for ${serviceName}...`);
    state.reconnectTimer = null; // Clear the timer reference before attempting
    connectToTarget(state.service); // Attempt connection again
  }, delay);
};

// --- Helper to close frontend clients ---
const closeAssociatedFrontendClients = (serviceName: string, code: number, reason: string) => {
    const clients = frontendClients.get(serviceName);
    if (clients) {
        console.log(`[Manager] Closing ${clients.size} frontend client(s) for ${serviceName}. Reason: ${reason}`);
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
                client.close(code, reason);
            }
        });
        frontendClients.delete(serviceName); // Clear the set for this service
    }
};

// --- Modified connectToTarget ---
const connectToTarget = (service: DiscoveredService): WebSocket | null => {
  const serviceName = service.name;
  const targetWsUrl = `ws://${service.address}:8080/`; // Recalculate here in case address changed
  let state = targetConnections.get(serviceName);

  // Ensure state exists (it should if called via initialize or reconnect)
  if (!state) {
      console.error(`[Manager] connectToTarget called for ${serviceName} but no state found. Creating.`);
      // Create a minimal state to proceed, but this indicates a potential logic error elsewhere
      state = {
          ws: null,
          service,
          targetWsUrl,
          reconnectTimer: null,
          reconnectAttempts: 0,
          isClosingIntentionally: false,
      };
      targetConnections.set(serviceName, state);
  }

  // Prevent multiple concurrent connection attempts
  if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
      console.log(`[Manager] Connection attempt for ${serviceName} skipped: Already connecting or open.`);
      return state.ws;
  }

  console.log(`[Manager] Attempting to connect to target: ${targetWsUrl} for service ${serviceName}`);

  try {
    const targetWs = new WebSocket(targetWsUrl);
    state.ws = targetWs;
    state.targetWsUrl = targetWsUrl; // Update URL in state
    state.isClosingIntentionally = false; // Reset flag on new attempt
    // Ensure frontend client set exists
    if (!frontendClients.has(serviceName)) {
      frontendClients.set(serviceName, new Set());
    }

    targetWs.on('open', () => {
      console.log(`[Manager] Backend connection to target ${targetWsUrl} opened.`);
      if (state) { // Check state exists
        state.reconnectAttempts = 0; // Reset attempts on successful connection
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
      }
      // Maybe notify clients or handle pending messages if needed
    });

    targetWs.on('message', (message, isBinary) => {
      // ---- Intercept the message BEFORE relaying ----
      interceptMessage(serviceName, message as Buffer | string, isBinary);
      // -----------------------------------------------

      const clients = frontendClients.get(serviceName);
      if (clients) {
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message, { binary: isBinary });
          }
        });
      } else {
         console.log(`[Manager] Received message from target ${serviceName}, but no frontend clients are connected.`);
      }
    });

    targetWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString();
      console.log(`[Manager] Target WebSocket ${targetWsUrl} closed:`, code, reasonStr);
      const currentState = targetConnections.get(serviceName);
      if (currentState) {
          currentState.ws = null; // Mark socket as closed in state
          if (!currentState.isClosingIntentionally) {
              console.log(`[Manager] Connection for ${serviceName} closed unexpectedly. Initiating reconnect sequence.`);
              scheduleReconnect(serviceName);
          } else {
              console.log(`[Manager] Connection for ${serviceName} closed intentionally. No reconnect.`);
              // Cleanup state if closed intentionally
              targetConnections.delete(serviceName);
          }
      }
      // Close associated frontend clients ONLY if the closure wasn't intentional
      // or if we are giving up on reconnects (handled in scheduleReconnect)
      if (!currentState || !currentState.isClosingIntentionally) {
           closeAssociatedFrontendClients(serviceName, 1011, `Target service '${serviceName}' disconnected: ${reasonStr || code}`);
      }
    });

    targetWs.on('error', (error) => {
      console.error(`[Manager] Target WebSocket ${targetWsUrl} error:`, error);
       const currentState = targetConnections.get(serviceName);
        if (currentState) {
            currentState.ws = null; // Mark socket as potentially unusable
            // The 'close' event will likely follow and handle reconnect logic.
            // If close doesn't follow, we might need more robust error handling here.
        }
        // Close frontend clients immediately on error
        closeAssociatedFrontendClients(serviceName, 1011, `Target service '${serviceName}' error: ${error.message}`);
    });

    return targetWs;

  } catch (err) {
      console.error(`[Manager] Failed to create WebSocket for ${targetWsUrl}:`, err);
      // If creating the WebSocket fails, we should still try to reconnect
      if (state) {
          state.ws = null;
          if (!state.isClosingIntentionally) {
              console.log(`[Manager] Error creating socket for ${serviceName}. Initiating reconnect sequence.`);
              scheduleReconnect(serviceName);
          }
      }
      return null;
  }
};

// --- Modified Exported Functions ---

// Function to get the *current* WebSocket object if open
export const getOpenTargetWebSocket = (serviceName: string): WebSocket | null => {
  const state = targetConnections.get(serviceName);
  if (state && state.ws && state.ws.readyState === WebSocket.OPEN) {
    return state.ws;
  } 
  return null;
};

// Function to check if a connection exists and is potentially usable (Open or Connecting)
export const hasActiveTargetConnection = (serviceName: string): boolean => {
    const state = targetConnections.get(serviceName);
    return !!(state && state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING));
};

// Modified: Initialize connection state and attempt first connection
export const initializeTargetConnection = (service: DiscoveredService): void => {
    if (!service.name || !service.address) {
        console.error('[Manager] Cannot initialize connection for service with missing name or address:', service);
        return;
    }
    const serviceName = service.name;
    let state = targetConnections.get(serviceName);

    if (!state) {
        console.log(`[Manager] Initializing connection state for discovered service: ${serviceName}`);
        state = {
            ws: null,
            service: { ...service }, // Store a copy
            targetWsUrl: `ws://${service.address}:8080/`,
            reconnectTimer: null,
            reconnectAttempts: 0,
            isClosingIntentionally: false
        };
        targetConnections.set(serviceName, state);
        connectToTarget(service); // Attempt initial connection
    } else {
        // State exists, update service details (address might have changed)
        state.service = { ...service };
        state.targetWsUrl = `ws://${service.address}:8080/`;
        state.isClosingIntentionally = false; // Ensure it's not marked for intentional close

        // If the connection is currently closed or closing, attempt to connect/reconnect
        if (!state.ws || state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
            console.log(`[Manager] Re-initializing connection for existing service: ${serviceName}`);
            // Clear any pending reconnect timer before explicitly connecting
             if (state.reconnectTimer) {
                 clearTimeout(state.reconnectTimer);
                 state.reconnectTimer = null;
             }
             state.reconnectAttempts = 0; // Reset attempts as this is an explicit (re)initialization
            connectToTarget(service);
        } else {
            // console.log(`[Manager] Service ${serviceName} re-discovered, connection already active.`);
        }
    }
};

// Modified: Mark for intentional closure and close socket
export const closeTargetConnection = (serviceName: string): void => {
    const state = targetConnections.get(serviceName);
    if (state) {
        console.log(`[Manager] Marking connection for intentional closure: ${serviceName}`);
        state.isClosingIntentionally = true;
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING )) {
            console.log(`[Manager] Closing active WebSocket for removed/down service: ${serviceName}`);
            state.ws.close(1000, 'Service removed or marked down'); // Normal closure
        } else {
            // If socket wasn't open/connecting, just remove the state
            console.log(`[Manager] No active WebSocket to close for ${serviceName}, removing state.`);
            targetConnections.delete(serviceName);
        }
         // Ensure associated frontend clients are also closed when connection is intentionally closed
        closeAssociatedFrontendClients(serviceName, 1000, 'Target service removed or marked down');
    } else {
        // console.log(`[Manager] closeTargetConnection called for ${serviceName}, but no state found.`);
    }
    // State cleanup now happens in the 'close' handler when isClosingIntentionally is true
};

// Modified: Ensure intentional closure is set for all connections
export const shutdownManager = (): void => {
    console.log('[Manager] Shutting down persistent WebSocket manager.');
    targetConnections.forEach((state, name) => {
        console.log(`[Manager] Closing connection to ${name} during shutdown.`);
        state.isClosingIntentionally = true; // Mark for intentional close
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
            state.ws.close(1000, 'Server shutting down');
        }
    });
    targetConnections.clear(); // Clear state map
    frontendClients.clear(); // Clear client map
     console.log('[Manager] All connections marked for closure and maps cleared.');
};

// --- Unchanged Frontend Client Management & Messaging ---

// Add a frontend client to a service group
export const addFrontendClient = (serviceName: string, frontendWs: WebSocket): void => {
    let clients = frontendClients.get(serviceName);
    if (!clients) {
        clients = new Set();
        frontendClients.set(serviceName, clients);
    }
    clients.add(frontendWs);
    console.log(`[Manager] Added frontend client for ${serviceName}. Total clients: ${clients.size}`);
};

// Remove a frontend client
export const removeFrontendClient = (serviceName: string, frontendWs: WebSocket): void => {
    const clients = frontendClients.get(serviceName);
    if (clients) {
        clients.delete(frontendWs);
        console.log(`[Manager] Removed frontend client for ${serviceName}. Remaining clients: ${clients.size}`);
    }
};

// Send message from a frontend client to the target service
export const sendMessageToTarget = (serviceName: string, message: Buffer | string, isBinary: boolean): void => {
    const state = targetConnections.get(serviceName);
    if (state && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(message, { binary: isBinary });
    } else {
        console.warn(`[Manager] Cannot send message to target ${serviceName}: WebSocket not open or not found.`);
        // Optionally notify the sending frontend client that the message couldn't be sent.
        // Find the specific frontend client and send an error? Requires reverse lookup or different structure.
    }
}; 