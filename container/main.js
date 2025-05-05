#!/usr/bin/env node

// --- Global Error Handling ---
process.on('uncaughtException', (error) => {
  console.error('--- Uncaught Exception ---');
  console.error(error);
  // Intentionally NOT exiting. Log the error and continue.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('--- Unhandled Rejection ---');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  // Intentionally NOT exiting. Log the error and continue.
});
// --- End Global Error Handling ---

const {
  serverCommand,
  serverDir,
  serverPropsPath,
  wsPort,
  serviceName,
  getRconPort,
  getRconPassword,
  rconHttpPort,
} = require('./config');
const { ensureRconEnabled } = require('./server-properties');
const { ensureEulaAccepted } = require('./eula-handler');
const { startMinecraftServer } = require('./minecraft-server');
const processManager = require('./process-manager');
const { startWebSocketServer } = require('./websocket-service');
const { publishService, unpublishService } = require('./mdns-service');
const { setupSignalHandler } = require('./signal-handler');
const { startRconHttpServer } = require('./rcon-http-service');
const path = require('path');
const rconState = require('./rcon-state');
const { addLog: addLogToStore } = require('./log-store');
const { parseTellraw } = require('./tellraw-parser');
const { sanitizeHtml } = require('./html-sanitizer');

// Object to hold the broadcast function, will be populated by websocket-service
const broadcast = { func: null }; 

// 1. Ensure EULA is accepted
const eulaPath = path.join(serverDir, 'eula.txt');
ensureEulaAccepted(eulaPath);

// Helper buffer for handleMinecraftOutput
let outputBuffer = '';

// 2. Ensure RCON is enabled and password is set
ensureRconEnabled(serverPropsPath);

// Define constants for RCON handling
const RCON_SUPPRESS_MS = 1500; // How long the RCON window stays open

// 3. Define callbacks for Minecraft server events
const handleMinecraftOutput = (data) => {
  const rawData = data.toString();
  outputBuffer += rawData;
  let newlineIndex;

  // Process all complete lines in the buffer
  while ((newlineIndex = outputBuffer.indexOf('\n')) >= 0) {
    const line = outputBuffer.substring(0, newlineIndex).trim(); // Extract line, trim whitespace
    outputBuffer = outputBuffer.substring(newlineIndex + 1); // Remove processed line from buffer

    if (line.length === 0) {
      continue; // Skip empty lines
    }

    // --- RCON HANDLING LOGIC ---

    // 1. Check for expired RCON window first
    if (rconState.rconResponseTimestamp && Date.now() - rconState.rconResponseTimestamp >= RCON_SUPPRESS_MS) {
        console.log("[DEBUG main] RCON window expired. Clearing RCON state.");
        rconState.rconResponseTimestamp = null;
        rconState.lastRconCommand = null;
        rconState.parsedTellrawText = null;
        // Keep capturedRconResponseLines, it was cleared by rcon-http for the response
        // rconState.capturedRconResponseLines = null; 
    }

    // 2. Check if we are currently *inside* an active RCON window
    if (rconState.rconResponseTimestamp /* No need for Date.now() comparison here */) {
        // --- ADDED LOGGING (Keep for now) ---
        console.log(`[DEBUG main - RCON Window Active] Checking line: "${line}" (Tellraw Text State: ${rconState.parsedTellrawText ? '"' + rconState.parsedTellrawText + '"' : 'null'})`);
        // --- END ADDED LOGGING ---

        // --- USE PRE-PARSED TELLRAW TEXT (if available) ---
        if (rconState.parsedTellrawText) {
            const originalText = rconState.parsedTellrawText;
            const sanitizedText = sanitizeHtml(originalText);
            
            // Format timestamp
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            const seconds = now.getSeconds().toString().padStart(2, '0');
            const timestamp = `${hours}:${minutes}:${seconds}`;

            // Prepend timestamp and prefix
            const formattedText = `[${timestamp}] [Discord Bridge] ${sanitizedText}`;

            console.log(`[DEBUG main] Using pre-parsed, sanitized, formatted tellraw: "${formattedText}"`);

            // Log and broadcast the FORMATTED text
            const wasLogged = addLogToStore(serviceName, formattedText);
            if (wasLogged && broadcast.func) {
                broadcast.func(formattedText + '\n');
            }

            // Clear ALL relevant RCON state - this tellraw command is fully handled
            console.log("[DEBUG main] Tellraw handled. Clearing RCON state.");
            rconState.rconResponseTimestamp = null;
            rconState.lastRconCommand = null;
            rconState.parsedTellrawText = null;
            // capturedRconResponseLines was already cleared by rcon-http

            // Skip further processing for this specific log line
            continue;
        }
        // --- END PRE-PARSED TELLRAW HANDLING ---

        // --- GENERAL RCON OUTPUT SUPPRESSION --- 
        // (Only runs if not handled as tellraw above)
        const isVerboseOutput = line.includes('[spark-worker-pool') || line.includes('[⚡]');
        const isSimpleFeedback = 
            /^\[\d{2}:\d{2}:\d{2}\] \[Server thread\/INFO\]: \[Server\]/.test(line) ||
            /^\[\d{2}:\d{2}:\d{2}\] \[Server thread\/INFO\]: Rcon issued server command:/.test(line) ||
            line.startsWith('Set the time to') || 
            line.startsWith('Player not found') ||
            line.includes('Unknown command') ||
            line.includes('Incorrect argument for command');

        if (isVerboseOutput || isSimpleFeedback) {
            console.log(`[DEBUG main] Suppressing potential RCON output (Verbose: ${isVerboseOutput}, Simple: ${isSimpleFeedback}): ${line}`); 
            // If capture array still exists (before http timeout clears it), store the suppressed line
            // Note: This capture is mainly for the HTTP response in rcon-http-service
            if (rconState.capturedRconResponseLines) { 
                rconState.capturedRconResponseLines.push(line);
            }
            // Don't clear state here, let window expire or tellraw handler clear it
            continue; // Skip logging and broadcasting this line
        }
        // --- END GENERAL RCON OUTPUT SUPPRESSION ---

        // If inside the window, but not tellraw and not suppressed, fall through to normal logging.
        // Still don't clear state here. The window expiration check at the start will handle it.
    }
    // --- END RCON HANDLING LOGIC ---

    // 3. Normal Log processing (runs if window expired or line wasn't handled/suppressed within window)
    // Attempt to add the log to the store using the main serviceName.
    // This also applies the filtering. Only runs if not suppressed above.
    const wasLogged = addLogToStore(serviceName, line);

    // Only broadcast if the line was not filtered by the log store
    if (wasLogged && broadcast.func) {
        broadcast.func(line + '\n');
    }
  }
  // Note: Any remaining content in outputBuffer is a partial line.
};

const handleMinecraftClose = (code, wasIntentional) => {
  const exitCode = code !== null ? code : 1;
  const reason = wasIntentional ? "intended stop/kill" : "unexpected exit";
  console.log(`Minecraft process closed with code ${exitCode} (Reason: ${reason})`);

  if (broadcast.func) {
    broadcast.func(`Server process exited with code ${exitCode} (Reason: ${reason})`);
  }

  // Only perform full shutdown if the stop was NOT intentional
  if (!wasIntentional) {
      console.log('Unexpected server exit detected. Shutting down wrapper application...');
      unpublishService(() => {
          console.log('mDNS service unpublished on server close');
          if (wss) {
              wss.close(() => console.log('WebSocket server closed on server exit'));
          }
          // rconHttpServer might need closing too? Let's add it.
          if (rconHttpServer) {
               rconHttpServer.close(() => console.log('RCON HTTP server closed on server exit'));
          }
          process.exit(exitCode);
      });
  } else {
       console.log('Intentional server stop detected. Wrapper application will continue running.');
       // Optionally, unpublish mDNS service if stopped intentionally?
       // unpublishService(() => console.log('mDNS service unpublished on intentional stop'));
       // For now, let's keep mDNS running so the controls are still discoverable
       // to potentially restart the server later.
  }
};

const handleMinecraftError = (error) => {
  if (broadcast.func) {
    broadcast.func(`Failed to start server process: ${error.message}`);
  }
  unpublishService(() => {
    console.log('mDNS service unpublished due to server error');
    process.exit(1);
  });
};

// 4. Configure and start the Minecraft server using the Process Manager
console.log('Configuring Process Manager...');
processManager.configure({
    command: serverCommand,
    directory: serverDir,
    onOutput: handleMinecraftOutput,
    onError: handleMinecraftError,
    onClose: handleMinecraftClose
});

console.log('Starting server via Process Manager...');
if (!processManager.start()) {
    // Handle case where start fails immediately (e.g., config error)
    // Note: Asynchronous errors are handled by handleMinecraftError
    console.error('Failed to initiate server start via Process Manager. Check configuration.');
    process.exit(1); // Exit if we can't even start the start process
}

// childProcess is no longer returned directly by startMinecraftServer
// We might need access to it for signal handling? Let's check signal-handler.js
// Yes, setupSignalHandler needs the child process.
// Let's modify process-manager to return the process or provide a way to get it.
// getProcess() already exists.

// 5. Define callback for WebSocket commands (Use processManager.sendCommand)
const handleWebSocketCommand = (command) => {
  if (processManager.isRunning()) {
     if (!processManager.sendCommand(command)) {
        console.error('Error writing command via Process Manager.');
     }
  } else {
      console.warn('WebSocket command ignored: Server process not running.');
  }
};

// 6. Start the WebSocket server
const wss = startWebSocketServer(wsPort, handleWebSocketCommand, broadcast);

// 7. Start the RCON HTTP server
const rconHttpServer = startRconHttpServer(rconHttpPort);

// 8. Publish mDNS service
publishService(serviceName, 'minecraft-control', 'tcp', wsPort);

// 9. Setup signal handler for graceful shutdown
setupSignalHandler(processManager, wss, rconHttpServer, unpublishService);

// Keep the process running
console.log('Main application setup complete. Running...'); 
