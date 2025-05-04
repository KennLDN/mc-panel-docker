const http = require('http');
const { Rcon } = require('rcon-client');
const { getRconPort, getRconPassword, serviceName } = require('./config');
const processManager = require('./process-manager');
const { getMinecraftServerPid } = require('./minecraft-server'); // Keep for /status endpoint compatibility
const { getServerStats } = require('./server-stats');
const rconState = require('./rcon-state');
const { addLog, getLogs } = require('./log-store');

// const serviceName = 'rcon-http'; // Removed - use imported serviceName

async function handleRconRequest(req, res) {
  // --- Log Endpoint ---
  if (req.method === 'GET' && req.url.startsWith('/logs/')) {
    const urlParts = req.url.split('/'); // Split URL to get the service name
    const requestedService = urlParts[2]; // Get the service name from the path

    // Log endpoint access to console only
    console.log(`Log endpoint hit. Request for service: ${requestedService || '[Not Specified]'}`);
    // logMsg(`Log endpoint hit. Request for service: ${requestedService || '[Not Specified]'}`); // Removed addLog call

    if (!requestedService) {
      // Log rejection to console only
      console.log(`Log request rejected: Missing service name in URL path.`);
      // logMsg(`Log request rejected: Missing service name in URL path.`); // Removed addLog call
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Request', message: 'Missing service name in URL path (e.g., /logs/your-service-name)' }));
      return;
    }

    // Get logs using the serviceName from the URL path
    // Note: All logs (minecraft, websocket, rcon-http) for this instance
    // should have been stored under this requestedService name by the other modules.
    const logs = getLogs(requestedService);
    // Log return info to console only
    console.log(`Returning ${logs.length} log lines for service: ${requestedService}`);
    // logMsg(`Returning ${logs.length} log lines for service: ${requestedService}`); // Removed addLog call
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Return logs as a JSON array of strings
    res.end(JSON.stringify({ service: requestedService, logs: logs })); // Report the serviceName from the path
    return;
  }

  // --- Status Endpoint ---
  if (req.method === 'GET' && req.url === '/status') {
    const pid = getMinecraftServerPid();
    if (!pid) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server Not Running', message: 'Minecraft server process is not running.' }));
      return;
    }

    try {
      const stats = await getServerStats(pid);
      if (stats.error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Status Error', message: stats.error }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
      }
    } catch (error) {
      console.error('Error fetching server stats:', error); // Log error to console
      // addLog(serviceName, `Error fetching server stats: ${error.message}`); // Removed
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: 'Failed to get server stats.' }));
    }
    return;
  }

  // --- Simple Server State Endpoint ---
  if (req.method === 'GET' && req.url === '/server-state') {
      const state = processManager.isRunning() ? "online" : "inactive";
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: state }));
      return;
  }

  // --- Control Endpoints ---
  if (req.method === 'POST' && req.url.startsWith('/control/')) {
      const controlAction = req.url.split('/')[2];
      console.log(`Control endpoint hit: ${controlAction}`);

      switch (controlAction) {
          case 'start':
              if (processManager.isRunning()) {
                  res.writeHead(409, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Already Running', message: 'Minecraft server is already running.' }));
              } else {
                  console.log('Attempting to start Minecraft server via Process Manager...');
                  try {
                      if (processManager.start()) { // Use manager's start
                           // Start was initiated, uses callbacks configured in main.js
                          console.log('Minecraft server start initiated via Process Manager.');
                          res.writeHead(202, { 'Content-Type': 'application/json' }); // 202 Accepted
                          res.end(JSON.stringify({ message: 'Minecraft server start initiated.' }));
                      } else {
                          // Should not happen if isRunning check passed, but handle defensively
                          console.error('Control Start Error: Process Manager indicated start failed unexpectedly.');
                          res.writeHead(500, { 'Content-Type': 'application/json' });
                          res.end(JSON.stringify({ error: 'Internal Server Error', message: 'Failed to start server process.' }));
                      }
                  } catch (error) {
                      // Catch errors like config not set (shouldn't happen if main.js ran)
                      console.error('Control Start Error: Failed to initiate start:', error);
                      res.writeHead(500, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ error: 'Internal Server Error', message: `Failed to start server process: ${error.message}` }));
                  }
              }
              break;
          case 'stop':
              if (processManager.stop()) { // Use manager's stop
                  res.writeHead(202, { 'Content-Type': 'application/json' }); // 202 Accepted
                  res.end(JSON.stringify({ message: 'Stop command sent to Minecraft server.' }));
              } else {
                   // Check if it failed because it wasn't running
                  if (!processManager.isRunning()) {
                       res.writeHead(409, { 'Content-Type': 'application/json' });
                       res.end(JSON.stringify({ error: 'Not Running', message: 'Minecraft server is not currently running.' }));
                  } else {
                      // Failed for another reason (e.g., stdin error)
                      console.error('Control Stop Error: Process Manager failed to send stop command.');
                      res.writeHead(500, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ error: 'Internal Server Error', message: 'Failed to send stop command.' }));
                  }
              }
              break;
          case 'restart':
              let stopInitiatedForRestart = false;
              if (processManager.isRunning()) {
                  console.log('Restart: Server running, attempting graceful stop via Process Manager...');
                  if (processManager.stop()) {
                      stopInitiatedForRestart = true;
                      console.log('Restart: Stop command sent via Process Manager.');
                  } else {
                      console.error('Control Restart Error: Failed to send stop command via Process Manager.');
                      res.writeHead(500, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ error: 'Restart Failed', message: 'Failed to send stop command during restart.' }));
                      return; // Exit early
                  }
              } else {
                  console.log('Restart: Server not running, proceeding directly to start.');
              }

              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Restart initiated. Server will stop (if running) and then start.' }));

              const performRestartStart = () => {
                  if (processManager.isRunning()) {
                      console.error('Control Restart Error: Server process still exists after stop attempt/wait. Aborting start.');
                      return;
                  }
                  console.log('Restart: Proceeding with server start via Process Manager...');
                  try {
                      if (processManager.start()) {
                          console.log('Restart: Server start initiated successfully via Process Manager.');
                      } else {
                           console.error('Control Restart Error: Process Manager start returned false unexpectedly.');
                      }
                  } catch (error) {
                      console.error('Control Restart Error: Failed to spawn process:', error);
                  }
              };

              if (stopInitiatedForRestart) {
                  const restartDelay = 5000;
                  console.log(`Restart: Waiting ${restartDelay}ms for server to stop...`);
                  setTimeout(performRestartStart, restartDelay);
              } else {
                  performRestartStart();
              }
              break;
          case 'kill':
              if (processManager.kill()) { // Use manager's kill
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ message: 'Kill signal sent to Minecraft server process.' }));
              } else {
                  res.writeHead(409, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Not Running', message: 'Minecraft server is not currently running.' }));
              }
              break;
          default:
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Bad Request', message: `Invalid control action: ${controlAction}` }));
      }
      return;
  }

  // --- RCON Command Endpoint ---
  if (req.method !== 'POST' || req.url !== '/rcon') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString(); // convert Buffer to string
  });

  req.on('end', async () => {
    let command;
    try {
      const parsedBody = JSON.parse(body);
      command = parsedBody.command;
      if (!command || typeof command !== 'string') {
        throw new Error('Missing or invalid "command" field in request body.');
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Request', message: error.message }));
      return;
    }

    const rconPort = getRconPort();
    const rconPassword = getRconPassword();
    let rcon = null; // Initialize rcon to null
    const RCON_RESPONSE_CAPTURE_DELAY_MS = 1200; // Wait this long for main.js to capture lines

    try {
      // Assuming the Minecraft server is running on the same host
      rcon = new Rcon({ host: 'localhost', port: rconPort, password: rconPassword });

      await rcon.connect();
      console.log(`RCON HTTP Service: Connected. Sending command: ${command}`);

      // Initialize state for capturing response via main.js filtering
      rconState.capturedRconResponseLines = []; 
      rconState.rconResponseTimestamp = Date.now(); // Start suppression/capture window
      console.log(`[DEBUG rcon-http] Initialized capture state. Timestamp: ${rconState.rconResponseTimestamp}`);

      // Send the command - we ignore the direct response as it might be empty for verbose commands
      await rcon.send(command);
      console.log(`[DEBUG rcon-http] RCON command sent. Waiting ${RCON_RESPONSE_CAPTURE_DELAY_MS}ms for captured response...`);

      // --- Wait for potential response lines to be captured by main.js --- 
      setTimeout(async () => {
          console.log(`[DEBUG rcon-http] Capture timeout finished. Processing captured lines.`);
          const capturedLines = rconState.capturedRconResponseLines || []; // Get captured lines
          const responseToSend = capturedLines.join('\n');

          // --- Clear state --- 
          rconState.rconResponseTimestamp = null; 
          rconState.capturedRconResponseLines = null;
          console.log(`[DEBUG rcon-http] Cleared capture state.`);

          // --- Send HTTP response --- 
          if (!res.writableEnded) { // Check if response hasn't already been ended (e.g., by an error)
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ response: responseToSend }));
              console.log(`[DEBUG rcon-http] Sent HTTP response with captured lines.`);
          } else {
              console.log(`[DEBUG rcon-http] HTTP response already ended, cannot send captured lines.`);
          }

          // --- Disconnect RCON --- 
          if (rcon) {
              try {
                  await rcon.end();
                  console.log('RCON HTTP Service: Disconnected (after timeout).');
              } catch (disconnectError) {
                  console.error('RCON HTTP Service: Error during disconnect (after timeout):', disconnectError);
              }
          }
      }, RCON_RESPONSE_CAPTURE_DELAY_MS);

      // --- REMOVED immediate response sending --- 
      // res.writeHead(200, { 'Content-Type': 'application/json' });
      // res.end(JSON.stringify({ response: response })); // Original response ignored
      // --- END REMOVED --- 

    } catch (error) {
      console.error('RCON HTTP Service Error:', error); 
      rconState.rconResponseTimestamp = null;   // Clear timestamp on error
      rconState.capturedRconResponseLines = null; // Clear capture state on error
      console.log('[DEBUG rcon-http] Cleared capture state due to error.');

      // --- Send error response immediately --- 
      if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'RCON Error', message: error.message }));
      }

      // --- Ensure disconnect on error --- 
      if (rcon) {
        try {
            await rcon.end();
            console.log('RCON HTTP Service: Disconnected (after error).');
        } catch (disconnectError) {
            console.error('RCON HTTP Service: Error during disconnect (after error):', disconnectError);
        }
      }
    } 
    // --- REMOVED finally block - Disconnect is handled in setTimeout or catch --- 
    // finally {
    //   if (rcon) {
    //     try {
    //       await rcon.end();
    //       console.log('RCON HTTP Service: Disconnected.');
    //     } catch (disconnectError) {
    //       console.error('RCON HTTP Service: Error during disconnect:', disconnectError);
    //     }
    //   }
    // }
    // --- END REMOVED --- 
  });

   req.on('error', (err) => {
       console.error('RCON HTTP Service: Request error:', err); // Log error to console
       // addLog(serviceName, `RCON HTTP Service: Request error: ${err.message}`); // Removed
       res.writeHead(500, { 'Content-Type': 'application/json' });
       res.end(JSON.stringify({ error: 'Server Request Error' }));
   });
}

function startRconHttpServer(port) {
  const server = http.createServer(handleRconRequest);

  server.listen(port, () => {
    // Log listen message to console only
    console.log(`RCON HTTP service listening on port ${port}`);
    // logMsg(`RCON HTTP service listening on port ${port}`); // Removed addLog call
  });

  server.on('error', (err) => {
      console.error(`RCON HTTP service error: ${err}`); // Log error to console
      // addLog(serviceName, `RCON HTTP service error: ${err.message}`); // Removed
      // Potentially exit or attempt recovery
      process.exit(1); // Exit if the server fails to start
  });

  return server; // Return the server instance for potential management (e.g., shutdown)
}

module.exports = { startRconHttpServer }; 