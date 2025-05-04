const path = require('path');
const os = require('os');

const serverCommand = process.env.SERVER_CMD;
const serverDir = path.join(__dirname, 'server'); // Define server directory path
const serverPropsPath = path.join(serverDir, 'server.properties'); // Path to server.properties
const wsPort = parseInt(process.env.WS_PORT || '8080', 10); // Get WebSocket port from env, default 8080
const serviceName = os.hostname(); // Use hostname
const rconPassword = process.env.RCON_PASSWORD || 'container-rcon'; // Get RCON password from env, default
const initialRconPortEnv = process.env.RCON_PORT; // Get RCON port from env
const DEFAULT_RCON_PORT = 25575;
const DEFAULT_RCON_PASSWORD = 'container-rcon'; // Default RCON password
const rconHttpPort = parseInt(process.env.RCON_HTTP_PORT || '8081', 10); // Port for the RCON HTTP endpoint

let currentRconPort = DEFAULT_RCON_PORT; // Default value
let currentRconPassword = process.env.RCON_PASSWORD || DEFAULT_RCON_PASSWORD; // Initialize with ENV or default

// Validate and set initial RCON port from environment variable if provided
if (initialRconPortEnv) {
  const parsedPort = parseInt(initialRconPortEnv, 10);
  if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    currentRconPort = parsedPort;
  } else {
    console.warn(`Invalid RCON_PORT environment variable value: ${initialRconPortEnv}. Using default port ${DEFAULT_RCON_PORT}.`);
  }
}

if (!serverCommand) {
  console.error('Error: SERVER_CMD environment variable not set.');
  process.exit(1);
}

// Function to update the RCON port if needed (e.g., read from server.properties)
function setRconPort(port) {
  const parsedPort = parseInt(port, 10);
  if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
     currentRconPort = parsedPort;
     console.log(`RCON port set to: ${currentRconPort}`);
  } else {
     console.warn(`Attempted to set invalid RCON port: ${port}. Keeping current value: ${currentRconPort}`);
  }
}

// Function to get the current RCON port
function getRconPort() {
  return currentRconPort;
}

// Function to update the RCON password if needed
function setRconPassword(password) {
  if (password && typeof password === 'string') {
    currentRconPassword = password;
    console.log('RCON password updated.'); // Avoid logging the password itself
  } else {
    console.warn('Attempted to set invalid RCON password. Keeping current value.');
  }
}

// Function to get the current RCON password
function getRconPassword() {
  return currentRconPassword;
}

module.exports = {
  serverCommand,
  serverDir,
  serverPropsPath,
  wsPort,
  serviceName,
  getRconPort, // Export getter
  setRconPort, // Export setter
  getRconPassword, // Export getter
  setRconPassword, // Export setter
  rconHttpPort, // Export RCON HTTP port
}; 