const { spawn } = require('child_process');
const pty = require('node-pty');

let runningServerProcess = null;
let intentionalStopInProgress = false; // Flag to track user-initiated stops
let serverConfig = {
    command: null,
    directory: null,
    onOutput: null,
    onError: null,
    onClose: null,
};

function configure(config) {
    if (!config.command || !config.directory || !config.onOutput || !config.onError || !config.onClose) {
        throw new Error("Process Manager Configuration Incomplete: Missing required fields.");
    }
    serverConfig = { ...config };
    console.log('Process Manager Configured.');
}

function start() {
    if (runningServerProcess) {
        console.warn('Start request ignored: Server process already running.');
        return false; // Indicate not started because already running
    }
    if (!serverConfig.command) {
        console.error('Start request failed: Process Manager not configured.');
        throw new Error("Cannot start server: Process Manager not configured.");
    }

    // Reset flag when starting
    intentionalStopInProgress = false;

    const { command, directory, onOutput, onError, onClose } = serverConfig;
    console.log(`Process Manager: Starting server with command: ${command} in directory ${directory}`);

    const args = command.split(' ');
    const executable = args.shift();

    console.log(`Process Manager: Parsed executable: ${executable}`);
    console.log(`Process Manager: Parsed args: ${JSON.stringify(args)}`);

    const child = pty.spawn(executable, args, {
        name: 'xterm-color', // Emulate a color terminal
        cols: 80, // Define terminal size (optional, adjust as needed)
        rows: 30,
        cwd: directory,
        env: process.env // Pass environment variables
    });

    child.onData((data) => {
        // --- DEBUG: Print raw data from PTY --- 
        console.log('[RAW PTY DATA]:', data);
        // -----------------------------------------

        // Call the configured handler (e.g., handleMinecraftOutput in main.js)
        // Data should already be string due to PTY handling
        onOutput(data);
    });

    child.onExit(({ exitCode, signal }) => {
        console.log(`Process Manager: PTY process exited with code ${exitCode}, signal ${signal}`);
        const wasIntentional = intentionalStopInProgress;
        runningServerProcess = null;
        intentionalStopInProgress = false;
        onClose(exitCode, wasIntentional);
    });

    runningServerProcess = child; // Store the PTY process
    console.log(`Process Manager: Server process started (PID: ${runningServerProcess.pid}).`);
    return true; // Indicate start initiated
}

function stop() {
    if (!runningServerProcess) {
        console.log('Stop request ignored: Server process not running.');
        return false; // Indicate not running
    }
    try {
        console.log('Process Manager: Setting intentional stop flag and sending "stop" command via PTY...');
        intentionalStopInProgress = true; // Set flag before sending command
        runningServerProcess.write('stop\r'); // Send command + carriage return for PTY
        return true; // Indicate stop command sent
    } catch (error) {
        console.error('Process Manager: Failed to write "stop" command to PTY:', error);
        intentionalStopInProgress = false; // Reset flag on error
        return false; // Indicate error
    }
}

function kill() {
    if (runningServerProcess) {
        console.log(`Process Manager: Force killing Minecraft server process (PID: ${runningServerProcess.pid})...`);
        intentionalStopInProgress = true; // Consider kill also intentional for shutdown logic
        runningServerProcess.kill('SIGKILL'); // Use PTY kill method
        // Note: runningServerProcess will be set to null by the 'onExit' event handler
        return true; // Indicate kill signal was sent
    }
    console.log('Kill request ignored: Minecraft server process not running.');
    return false; // Indicate process was not running
}

function getProcess() {
    return runningServerProcess;
}

function getPid() {
    return runningServerProcess ? runningServerProcess.pid : null;
}

function isRunning() {
    return !!runningServerProcess;
}

// Added function to send arbitrary commands (like stop, but generic)
function sendCommand(commandString) {
     if (!runningServerProcess) {
        console.log('sendCommand ignored: Server process not running.');
        return false;
    }
    // Use PTY write
    try {
        console.log(`Process Manager: Sending command "${commandString}" to Minecraft server via PTY.`);
        runningServerProcess.write(commandString + '\r'); // Send command + carriage return
        return true; // Indicate command sent
    } catch (error) {
        console.error(`Process Manager: Failed to write command "${commandString}" to PTY:`, error);
        return false;
    }
}


module.exports = {
    configure,
    start,
    stop,
    kill,
    getProcess,
    getPid,
    isRunning,
    sendCommand, // Export the new function
}; 