const pidusage = require('pidusage');

async function getServerStats(pid) {
  if (!pid) {
    return { error: 'Server process not running or PID not available.' };
  }

  try {
    const stats = await pidusage(pid);
    // stats contains cpu, memory, ppid, pid, ctime, elapsed, timestamp
    return {
      cpu: stats.cpu.toFixed(2), // CPU percentage
      memory: (stats.memory / 1024 / 1024).toFixed(2), // Memory in MB
      pid: stats.pid,
      uptime: (stats.elapsed / 1000).toFixed(0) // Uptime in seconds
    };
  } catch (error) {
    console.error(`Error getting stats for PID ${pid}:`, error);
    // Handle cases where the process might have just exited
    if (error.message.includes('No matching pid found')) {
        return { error: 'Server process not found (may have stopped).' };
    }
    return { error: 'Failed to retrieve server stats.', details: error.message };
  }
}

module.exports = { getServerStats }; 