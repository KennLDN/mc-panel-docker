const rconState = require('./rcon-state');

const MAX_LOG_LINES = 5000;
const RCON_RESPONSE_TIMEOUT_MS = 2000; // 2 seconds tolerance for matching RCON responses

const logStore = {}; // { serviceName: [logLine1, logLine2, ...] }

// --- DEBUGGING --- Add a counter
// let logAttemptCounter = 0; // Removed

function addLog(serviceName, message) {
    // logAttemptCounter++; // Removed
    const messageStr = message.toString().trim();
    // console.log(`[LogStore DEBUG ${logAttemptCounter}] Attempting to add to '${serviceName}': "${messageStr}"`); // Removed

    if (!messageStr) {
        // console.log(`[LogStore DEBUG ${logAttemptCounter}] Filtered: Empty message.`); // Removed
        return false; // Ignore empty messages
    }

    // Filter 1: Ignore RCON client thread messages
    if (messageStr.includes('[RCON Client]') || messageStr.includes('Thread RCON Client ')) { 
        // console.log(`[LogStore DEBUG] Filtered: Contains RCON client marker.`); // Removed
        return false;
    }

    // Filter 2: Ignore lines matching recent RCON command responses
    // --- REMOVED Filter 2 - This logic moved to main.js with a different approach ---
    // // --- DEBUG START ---
    // const stateBeforeCheck = JSON.parse(JSON.stringify(rconState)); // Deep copy for logging
    // const shouldFilter = rconState.expectedRconResponseLines && rconState.rconResponseTimestamp;
    // console.log(`[DEBUG log-store] Checking filter for: "${messageStr}" | Should Filter Active: ${shouldFilter} | State: ${JSON.stringify(stateBeforeCheck)}`);
    // // --- DEBUG END ---
    // if (rconState.expectedRconResponseLines && rconState.rconResponseTimestamp) {
    //     const now = Date.now();
    //     // console.log(`[LogStore DEBUG ${logAttemptCounter}] Checking RCON response. Now: ${now}, Timestamp: ${rconState.rconResponseTimestamp}, Diff: ${now - rconState.rconResponseTimestamp}ms, Expected: ${JSON.stringify(rconState.expectedRconResponseLines)}`); // Removed
    //     if (now - rconState.rconResponseTimestamp < RCON_RESPONSE_TIMEOUT_MS) {
    //         const matchIndex = rconState.expectedRconResponseLines.indexOf(messageStr);
    //         if (matchIndex !== -1) {
    //             // console.log(`[LogStore DEBUG ${logAttemptCounter}] Filtered: Matched expected RCON response line at index ${matchIndex}.`); // Removed
    //             // Remove the matched line so it's not filtered again unnecessarily
    //             rconState.expectedRconResponseLines.splice(matchIndex, 1);
    //             // If all expected lines are matched, clear the state
    //             if (rconState.expectedRconResponseLines.length === 0) {
    //                 // console.log(`[LogStore DEBUG ${logAttemptCounter}] All expected RCON lines filtered. Clearing state.`); // Removed
    //                 rconState.expectedRconResponseLines = null;
    //                 rconState.rconResponseTimestamp = null;
    //             }
    //             return false; // Filter this line
    //         }
    //     } else {
    //          // Timestamp expired, clear the expectation
    //          // console.log(`[LogStore DEBUG ${logAttemptCounter}] RCON response timestamp expired. Clearing state.`); // Removed
    //          rconState.expectedRconResponseLines = null;
    //          rconState.rconResponseTimestamp = null;
    //     }
    // // } else { // Removed enclosing else
    // //   console.log(`[LogStore DEBUG ${logAttemptCounter}] No active RCON response filtering.`); // Removed
    // }
    // --- END REMOVED Filter 2 ---


    if (!logStore[serviceName]) {
        // console.log(`[LogStore DEBUG ${logAttemptCounter}] Initializing store for service '${serviceName}'.`); // Removed
        logStore[serviceName] = [];
    }

    logStore[serviceName].push(messageStr);
    // console.log(`[LogStore DEBUG ${logAttemptCounter}] Added to '${serviceName}'. Current count: ${logStore[serviceName].length}`); // Removed

    // Enforce max lines limit
    if (logStore[serviceName].length > MAX_LOG_LINES) {
        const removed = logStore[serviceName].shift(); // Remove the oldest line
        // console.log(`[LogStore DEBUG ${logAttemptCounter}] Store limit reached for '${serviceName}'. Removed oldest line: "${removed}"`); // Removed
    }
    return true; // Log was added
}

function getLogs(serviceName) {
    // console.log(`[LogStore DEBUG] getLogs called for service: ${serviceName}`); // Removed
    return logStore[serviceName] || [];
}

function getAllLogs() {
    // console.log('[LogStore DEBUG] getAllLogs called.'); // Removed
    return logStore;
}

module.exports = { addLog, getLogs, getAllLogs }; 