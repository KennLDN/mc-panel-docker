// This module is now a thin wrapper around process-manager.js
const processManager = require('./process-manager');

function getMinecraftServerPid() {
    return processManager.getPid();
}

// We might not even need this module anymore if all callers
// switch to using processManager directly. Keeping it for now
// for compatibility with existing imports.

module.exports = { getMinecraftServerPid }; 