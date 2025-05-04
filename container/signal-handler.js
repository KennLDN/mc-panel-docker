function setupSignalHandler(processManager, webSocketServer, rconHttpServer, unpublishService) {
    process.on('SIGINT', () => {
        console.log('Received SIGINT. Shutting down...');

        // Get the current process from the manager
        const childProcess = processManager.getProcess();

        // Stop mDNS advertising first
        unpublishService(() => {
            console.log('mDNS cleanup complete.');

            // Close RCON HTTP Server
            if (rconHttpServer) {
                rconHttpServer.close(() => console.log('RCON HTTP server closed'));
            }

            // Close WebSocket server
            if (webSocketServer) {
                webSocketServer.close(() => console.log('WebSocket server closed'));
            }

            // Attempt graceful shutdown of child process
            if (childProcess) {
                console.log('Sending SIGINT to Minecraft server process...');
                // Use manager's kill function with SIGINT for graceful attempt
                childProcess.kill('SIGINT');
                // processManager.stop(); // Alternative: Use the manager's stop function

                // Give child process some time to exit gracefully via its 'close' handler
                // The main process exit is now handled in the handleMinecraftClose callback in main.js
                // So, we don't necessarily need a timeout *here* to force kill and exit.
                // However, a safety net might still be good.
                const forceKillTimeout = 5000; // Wait 5 seconds before force kill
                const timeoutId = setTimeout(() => {
                    // Check if process *still* exists via manager
                    if (processManager.isRunning()) {
                        console.log(`Child process did not exit after ${forceKillTimeout}ms, forcing kill (SIGKILL)...`);
                        processManager.kill(); // Use manager's kill (defaults to SIGKILL)
                        // Still rely on the onClose handler in main.js to eventually exit the main process
                    } else {
                         console.log('Child process exited gracefully within timeout.');
                    }
                }, forceKillTimeout);

                // Optional: Clear timeout if the process closes normally before the timer fires
                // This requires the onClose handler to somehow clear this timeout.
                // For simplicity, let the timeout run; it will just log if the process is already gone.

            } else {
                 console.log('Minecraft process not running. Exiting Node process.');
                 // If the MC process wasn't running, the onClose callback won't fire, so we exit here.
                 process.exit(0);
            }
        });
    });
}

module.exports = { setupSignalHandler }; 