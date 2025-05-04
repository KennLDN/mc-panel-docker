const fs = require('fs'); // Import fs module
const { setRconPort } = require('./config'); // Import the setter
const { getRconPassword, setRconPassword, DEFAULT_RCON_PASSWORD } = require('./config'); // Import password functions and default
const DEFAULT_RCON_PORT = 25575; // Define default RCON port

// Function to ensure enable-rcon=true and set rcon.password in server.properties
function ensureRconEnabled(filePath) {
  try {
    let properties = {};
    let needsWrite = false; // Flag to track if file needs saving
    let fileContent = '';
    const rconPortEnv = process.env.RCON_PORT;
    const rconPasswordEnv = process.env.RCON_PASSWORD;

    if (fs.existsSync(filePath)) {
      fileContent = fs.readFileSync(filePath, 'utf8');
      fileContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key) {
            properties[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
    } else {
       console.log(`server.properties not found at ${filePath}. Creating with default settings.`);
       needsWrite = true; // Need to write the new file
    }

    // RCON Port Logic
    let effectiveRconPort = DEFAULT_RCON_PORT;
    if (rconPortEnv) {
        // Environment variable is set, prioritize it
        const parsedEnvPort = parseInt(rconPortEnv, 10);
        if (!isNaN(parsedEnvPort) && parsedEnvPort > 0 && parsedEnvPort <= 65535) {
            effectiveRconPort = parsedEnvPort;
            if (String(properties['rcon.port']) !== String(effectiveRconPort)) {
                console.log(`Overwriting rcon.port with environment variable value: ${effectiveRconPort}`);
                properties['rcon.port'] = String(effectiveRconPort);
                needsWrite = true;
            }
        } else {
            // Invalid environment variable, log warning, use default, and write default to file if necessary
            console.warn(`Invalid RCON_PORT environment variable: ${rconPortEnv}. Using default ${DEFAULT_RCON_PORT}.`);
            effectiveRconPort = DEFAULT_RCON_PORT;
            if (String(properties['rcon.port']) !== String(DEFAULT_RCON_PORT)) {
                properties['rcon.port'] = String(DEFAULT_RCON_PORT);
                needsWrite = true;
            }
        }
    } else {
        // Environment variable is NOT set, use value from file or default
        if (properties['rcon.port']) {
            const parsedFilePort = parseInt(properties['rcon.port'], 10);
            if (!isNaN(parsedFilePort) && parsedFilePort > 0 && parsedFilePort <= 65535) {
                effectiveRconPort = parsedFilePort;
            } else {
                console.log(`Invalid rcon.port found in server.properties (${properties['rcon.port']}). Setting to default ${DEFAULT_RCON_PORT}.`);
                properties['rcon.port'] = String(DEFAULT_RCON_PORT);
                effectiveRconPort = DEFAULT_RCON_PORT;
                needsWrite = true;
            }
        } else {
            console.log(`rcon.port not found in server.properties. Setting to default ${DEFAULT_RCON_PORT}.`);
            properties['rcon.port'] = String(DEFAULT_RCON_PORT);
            effectiveRconPort = DEFAULT_RCON_PORT;
            needsWrite = true;
        }
    }

    // Update the shared config state with the effective RCON port
    setRconPort(effectiveRconPort);

    // RCON Password Logic
    let effectiveRconPassword = DEFAULT_RCON_PASSWORD;
    if (rconPasswordEnv) {
        // Environment variable is set, prioritize it
        effectiveRconPassword = rconPasswordEnv;
        if (properties['rcon.password'] !== effectiveRconPassword) {
            console.log(`Overwriting rcon.password with environment variable value.`); // Don't log the password
            properties['rcon.password'] = effectiveRconPassword;
            needsWrite = true;
        }
    } else {
        // Environment variable is NOT set, use value from file or default
        if (properties['rcon.password']) {
            effectiveRconPassword = properties['rcon.password'];
        } else {
            console.log(`rcon.password not found in server.properties. Setting to default.`); // Don't log the default password either
            properties['rcon.password'] = DEFAULT_RCON_PASSWORD;
            effectiveRconPassword = DEFAULT_RCON_PASSWORD;
            needsWrite = true;
        }
    }

    // Update the shared config state with the effective RCON password
    setRconPassword(effectiveRconPassword);

    // Ensure enable-rcon is true
    if (properties['enable-rcon'] !== 'true') {
      console.log(`Setting enable-rcon=true in ${filePath}`);
      properties['enable-rcon'] = 'true';
      needsWrite = true; // Mark that file needs to be written
    }

    // Write the file only if changes were made
    if (needsWrite) {
        console.log(`Writing updated server.properties to ${filePath}`);
        const newContent = Object.entries(properties)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n');
        fs.writeFileSync(filePath, newContent, 'utf8');
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    // Decide if we should exit or continue
    // process.exit(1);
  }
}

module.exports = { ensureRconEnabled }; 