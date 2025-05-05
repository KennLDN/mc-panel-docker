const rconState = {
  // expectedRconResponseLines: null, // Removed - This approach didn't work for multi-line async responses
  rconResponseTimestamp: null,   // Timestamp (ms) when RCON command was SENT, used by main.js for suppression window
  capturedRconResponseLines: null, // Array to store lines suppressed by main.js filter during the window, returned by rcon-http
  lastRconCommand: null,         // The last RCON command sent, used by main.js (kept for potential future use/debug)
  parsedTellrawText: null,       // Stores the pre-parsed plain text from the last tellraw command
};

module.exports = rconState; 