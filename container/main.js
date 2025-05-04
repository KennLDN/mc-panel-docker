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

// Object to hold the broadcast function, will be populated by websocket-service
const broadcast = { func: null }; 

// 1. Ensure EULA is accepted
const eulaPath = path.join(serverDir, 'eula.txt');
ensureEulaAccepted(eulaPath);

// Helper buffer for handleMinecraftOutput
let outputBuffer = '';

// 2. Ensure RCON is enabled and password is set
ensureRconEnabled(serverPropsPath);

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

    // --- NEW FILTER for potential RCON command output ---
    const RCON_SUPPRESS_MS = 1500; // Suppress for 1.5 seconds after RCON command timestamp

    // Check if timestamp is recent
    if (rconState.rconResponseTimestamp && Date.now() - rconState.rconResponseTimestamp < RCON_SUPPRESS_MS)
    {
        // Define patterns/checks for different types of RCON-related output

        // 1. Verbose patterns (e.g., Spark)
        const isVerboseOutput = line.includes('[spark-worker-pool') || line.includes('[⚡]');

        // 2. Simple feedback patterns (match common log formats for command output)
        //    These need to match the *actual log line format*
        //    Examples (adjust regex/patterns based on your server's specific log output):
        const isSimpleFeedback = 
            // Matches lines like: [HH:MM:SS] [Server thread/INFO]: [Server] Some message
            /^\S+ \S+ \S+ \[Server thread\/INFO\]: \[Server\]/.test(line) ||
            // Matches lines like: [HH:MM:SS] [Server thread/INFO]: Rcon issued server command: /somecommand
            /^\S+ \S+ \S+ \[Server thread\/INFO\]: Rcon issued server command:/.test(line) ||
            // Matches specific command outputs directly if simpler
            line.startsWith('Set the time to') || 
            line.startsWith('Player not found') ||
            line.includes('Unknown command') ||
            line.includes('Incorrect argument for command'); // Add more specific patterns as needed

        // Suppress if it matches *either* verbose or simple feedback patterns within the window
        if (isVerboseOutput || isSimpleFeedback) {
            console.log(`[DEBUG main] Suppressing potential RCON output (Verbose: ${isVerboseOutput}, Simple: ${isSimpleFeedback}): ${line}`); 
            // --- CAPTURE START ---
            // If capture is active, store the suppressed line
            if (rconState.capturedRconResponseLines) { 
                rconState.capturedRconResponseLines.push(line);
            }
            // --- CAPTURE END ---
            continue; // Skip logging and broadcasting this line
        }

    }
    // --- END NEW FILTER ---

    // Attempt to add the log to the store using the main serviceName. This also applies the filtering.
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
