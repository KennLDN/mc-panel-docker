const WebSocket = require('ws');
const { addLog } = require('./log-store');
const { serviceName } = require('./config'); // Import the main serviceName

function startWebSocketServer(port, onCommand, broadcast) {
    const wss = new WebSocket.Server({ port });
    const clients = new Set();

    // const serviceName = 'websocket'; // Removed - use imported serviceName
    const logMsg = (msg) => {
      console.log(msg); // Keep console logging for the wrapper app's status
      // addLog(serviceName, msg); // Removed: Do not add wrapper status messages to the child process log store
    }

    logMsg(`WebSocket server started on port ${port}`);

    wss.on('connection', (ws) => {
        logMsg('Client connected');
        clients.add(ws);

        ws.on('message', (message) => {
            try {
                const command = message.toString();
                // Do not log received commands to the main store, keep it clean for server output
                // logMsg(`Received command from client: ${command}`);
                console.log(`Received command from client: ${command}`); // Log command to console only
                onCommand(command); // Pass command to handler
            } catch (error) {
                // Log errors to console, but not the main store
                console.error('Error processing message:', error);
                // addLog(serviceName, `Error processing message: ${error.message}`); // Removed
            }
        });

        ws.on('close', () => {
            logMsg('Client disconnected');
            clients.delete(ws);
        });

        ws.on('error', (error) => {
            // Log errors to console, but not the main store
            console.error('WebSocket error:', error);
            // addLog(serviceName, `WebSocket error: ${error.message}`); // Removed
            clients.delete(ws); // Clean up on error
        });
    });

    // Assign the broadcast function externally provided
    // This allows minecraft-server module to use it via main.js
    const broadcastMessage = (data) => {
        // Do not log broadcast messages here, they originate from minecraft output which is already logged
        const message = data.toString();
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                // The filtering for [RCON Client] and RCON responses is handled upstream
                // before the message gets to broadcastMessage, so no need to filter here.
                client.send(message);
            }
        });
    };

    // Make broadcast function available
    if (broadcast) {
        broadcast.func = broadcastMessage;
    }

    return wss; // Return the WebSocket server instance
}

module.exports = { startWebSocketServer }; 