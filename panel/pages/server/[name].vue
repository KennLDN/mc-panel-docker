<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import type { DiscoveredService } from '~/server/utils/mdnsUtils';
import type { ServiceFlags } from '~/server/utils/flagsUtils';

// Define interface for the expected status response structure (matching the backend)
interface StatusResponse {
  cpu: string;
  memory: string;
  pid: number;
  uptime: string;
}

// Define interface for the expected control response structure
interface ControlResponse {
  message: string;
}

// Define interface for the expected TPS result response structure (raw string)
interface TpsResultResponse {
  tps: string | null;
}

// --- New Interface for Parsed TPS Data ---
interface ParsedTpsData {
  tps: {
    '5s': string;
    '10s': string;
    '1m': string;
    '5m': string;
    '15m': string;
  } | null;
  tickDuration: {
    '10s': { min: string; med: string; p95: string; max: string };
    '1m': { min: string; med: string; p95: string; max: string };
  } | null;
  cpuUsage: {
    system: { '10s': string; '1m': string; '15m': string };
    process: { '10s': string; '1m': string; '15m': string };
  } | null;
}

const route = useRoute();
const serviceName = computed(() => route.params.name as string);
const service = ref<DiscoveredService | null>(null);
const isLoading = ref(true);
const error = ref<string | null>(null);
const wsMessages = ref<string[]>([]);
const historicalLogs = ref<string[]>([]);
const wsStatus = ref<'connecting' | 'open' | 'closed' | 'error'>('connecting');
const commandInput = ref('');
const consoleOutputRef = ref<HTMLElement | null>(null);
const relayWsUrlDisplay = ref('');
const pendingCommands = ref<string[]>([]); // Queue for offline commands

// State for service status
const serviceStatus = ref<StatusResponse | null>(null);
const statusLoading = ref(false);
const statusError = ref<string | null>(null);
let statusInterval: ReturnType<typeof setInterval> | null = null; // Timer ID

// State for control actions
const controlLoading = ref<string | null>(null); // Stores the action being processed, e.g., 'start'
const controlError = ref<string | null>(null);
const controlSuccess = ref<string | null>(null);

// --- State for Flags --- (New)
const serviceFlags = ref<ServiceFlags | null>(null);
const flagsLoading = ref(false);
const flagsError = ref<string | null>(null);
const enableTpsLoading = ref(false); // Loading state for enabling TPS

// --- State for TPS Data --- (Updated)
const tpsResult = ref<ParsedTpsData | null>(null); // Changed to hold parsed data
const tpsLoading = ref(false);
const tpsError = ref<string | null>(null);
let tpsPollingInterval: ReturnType<typeof setInterval> | null = null;
const TPS_POLL_INTERVAL_MS = 10000; // Poll TPS every 10 seconds

// --- State for Client-Side Uptime Ticker ---
const clientUptimeBaseSeconds = ref<number | null>(null);
const clientUptimeBaseTimestamp = ref<number | null>(null);
const clientSideTicker = ref<number>(0); // Updates every second to trigger computed property
let clientTickerInterval: ReturnType<typeof setInterval> | null = null;

// --- Computed Property for Formatted Uptime (Now uses client-side ticker) ---
const formattedUptime = computed(() => {
  // Trigger reactivity when the ticker updates
  clientSideTicker.value;

  if (clientUptimeBaseSeconds.value === null || clientUptimeBaseTimestamp.value === null) {
    // Fallback to last polled value if client ticker isn't initialized
    if (serviceStatus.value?.uptime && !isNaN(Number(serviceStatus.value.uptime))) {
      return formatSeconds(Number(serviceStatus.value.uptime));
    }
    return 'N/A';
  }

  const elapsedSeconds = (Date.now() - clientUptimeBaseTimestamp.value) / 1000;
  const currentUptimeSeconds = clientUptimeBaseSeconds.value + elapsedSeconds;

  return formatSeconds(currentUptimeSeconds);
});

// Helper function to format seconds (extracted logic)
const formatSeconds = (totalSeconds: number): string => {
  if (totalSeconds < 0) return 'N/A';

  const days = Math.floor(totalSeconds / (60 * 60 * 24));
  const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: { value: number; unit: string }[] = [
    { value: days, unit: 'd' },
    { value: hours, unit: 'h' },
    { value: minutes, unit: 'm' },
    { value: seconds, unit: 's' },
  ];

  const significantParts = parts.filter(part => part.value > 0);

  if (significantParts.length === 0) {
    // Handle case where totalSeconds is between 0 and 1
    return totalSeconds < 1 ? '< 1s' : '0s';
  }

  const partsToShow = significantParts.slice(0, 2);
  return partsToShow.map(part => `${part.value}${part.unit}`).join(' ');
};

let websocket: WebSocket | null = null;

// --- Helper function to colorize log lines ---
const colorizeLogLine = (line: string): string => {
  // 1. Colorize timestamp (blue)
  const timestampRegex = /(\[\d{2}:\d{2}:\d{2}\])/; // Corrected: Removed unnecessary escapes for []
  let colorizedLine = line.replace(timestampRegex, '<span class="text-blue-400">$1</span>');

  // 2. Colorize the next bracketed section (fuchsia/pink) if it follows the timestamp
  //    Looks for: <blue-span>[HH:MM:SS]</blue-span> [Second Part]
  const secondPartRegex = /(<span class="text-blue-400">\[\d{2}:\d{2}:\d{2}\]<\/span>)(\s)(\[[^\]]+\])/;
  colorizedLine = colorizedLine.replace(secondPartRegex, '$1$2<span class="text-violet-400">$3</span>');

  return colorizedLine;
};

// Function to scroll the console to the bottom
const scrollToBottom = async () => {
  await nextTick(); // Wait for the DOM to update
  if (consoleOutputRef.value) {
    consoleOutputRef.value.scrollTop = consoleOutputRef.value.scrollHeight;
  }
};

// Fetch service details, flags, and potentially start TPS polling
const fetchInitialData = async () => {
  isLoading.value = true;
  error.value = null;
  historicalLogs.value = [];
  serviceFlags.value = null; // Reset flags on initial load
  flagsError.value = null; // Reset flag error

  try {
    // Fetch Service Details first
    service.value = await $fetch<DiscoveredService>(`/api/services/${encodeURIComponent(serviceName.value)}`);

    // Fetch Historical Logs
    try {
      const logs = await $fetch<string[]>(`/api/logs/${encodeURIComponent(serviceName.value)}`);
      // Colorize historical logs
      historicalLogs.value = logs.map(log => colorizeLogLine(log));
    } catch (logErr: any) {
      console.error('Error fetching historical logs:', logErr);
      // Colorize error message if needed, though unlikely to contain a timestamp
      wsMessages.value.push(colorizeLogLine('<span class="text-yellow-500">[System] Failed to fetch historical logs.</span>'));
    }

    // Fetch Flags (New)
    await fetchFlags();

    // Connect WebSocket
    connectWebSocket();

    // Fetch initial status *after* service details are available
    if (service.value) {
        await fetchServiceStatus(); // Initial fetch
        if (statusError.value !== 'offline') {
            startStatusPolling();
        }
    }
     // Initial scroll after logs and status
    await scrollToBottom();

  } catch (err: any) {
    console.error('Error fetching initial data:', err);
    error.value = err.data?.message || `Failed to load data for ${serviceName.value}.`;
    // Ensure loading states are false even if initial fetch fails
    flagsLoading.value = false; 
  } finally {
    isLoading.value = false;
    // Ensure scrolling happens after all initial loading/status checks
    await scrollToBottom(); 
  }
};

const connectWebSocket = () => {
  if (!service.value) return;

  // Construct the WebSocket URL for our backend relay
  const relayWsUrl = new URL(`/api/ws/relay/${encodeURIComponent(serviceName.value)}`, window.location.origin);
  relayWsUrl.protocol = relayWsUrl.protocol.replace('http', 'ws'); // Change http(s) to ws(s)

  wsStatus.value = 'connecting';
  wsMessages.value = []; // Clear previous messages on new connection attempt

  try {
    websocket = new WebSocket(relayWsUrl.href);

    websocket.onopen = () => {
      wsStatus.value = 'open';

      // --- Send queued commands ---
      if (pendingCommands.value.length > 0) {
          console.log(`Sending ${pendingCommands.value.length} queued commands.`);
          wsMessages.value.push('<span class="text-yellow-500">[System] Connection re-established. Sending queued commands...</span>');
          const commandsToSend = [...pendingCommands.value]; // Copy queue
          pendingCommands.value = []; // Clear queue immediately
          commandsToSend.forEach(cmd => {
              if (websocket && wsStatus.value === 'open') { // Double check connection still open
                  websocket.send(cmd);
                   // Add a confirmation that the *queued* command was sent now
                  // wsMessages.value.push(`<span class="text-green-500">[Sent] > ${cmd}</span>`); // Optional: Confirmation
              } else {
                   // If connection dropped again *while* sending queue, re-queue remaining
                   console.warn('WebSocket closed while sending queued command:', cmd);
                   pendingCommands.value.push(cmd); // Re-add to queue
                   wsMessages.value.push(`<span class="text-red-500">[Failed Re-queue] > ${cmd}</span>`);
              }
          });
          if (pendingCommands.value.length === 0) {
              wsMessages.value.push('<span class="text-yellow-500">[System] All queued commands sent.</span>');
          } else {
              wsMessages.value.push(`<span class="text-yellow-500">[System] ${pendingCommands.value.length} commands remain queued due to connection issues.</span>`);
          }
      }
    };

    websocket.onmessage = (event) => {
      // Messages from the backend relay are directly the messages from the target service
      // console.log('WebSocket message received via relay:', event.data); // Log raw data if needed

      // --- Filter out command echo ---
      const newMessage = event.data.trim();
      const lastMessage = wsMessages.value[wsMessages.value.length - 1];
      const sentCommandRegex = /<span[^>]*>\s*>\s*(.*?)<\/span>/; // Regex to extract command from the span
      const match = lastMessage?.match(sentCommandRegex);

      // Check if the last message was a sent command AND the new message is the plain echo of it
      if (match && match[1] && match[1].trim() === newMessage) {
        // This is an echo of the command we just sent, so we skip adding it.
      } else {
        // Colorize the message before adding it
        const colorizedMessage = colorizeLogLine(newMessage);
        wsMessages.value.push(colorizedMessage);
      }
      // --- End filter ---

      // Note: Scrolling is handled by the watcher now
    };

    websocket.onerror = (event) => {
      console.error('WebSocket relay error:', event);
      wsStatus.value = 'error';
    };

    websocket.onclose = (event) => {
      const previousStatus = wsStatus.value;
      wsStatus.value = 'closed';

      // Attempt to reconnect if the closure was unexpected
      if (!event.wasClean && serviceName.value) { // Check if serviceName is still valid
        console.log('WebSocket relay closed unexpectedly. Attempting to reconnect...');
        // Optional: Add a small delay before reconnecting
        setTimeout(() => {
            // Ensure we don't try to connect if the component is being unmounted
            if (websocket !== null && wsStatus.value !== 'open') {
                 connectWebSocket();
            }
        }, 1000); // 1-second delay
      }
    };
  } catch (err) {
    console.error('Failed to create WebSocket relay connection:', err);
    wsStatus.value = 'error';
    error.value = 'Failed to initialize WebSocket relay connection.';
  }
};

const sendCommand = () => {
  const commandToSend = commandInput.value.trim();
  if (!commandToSend) {
      console.warn('Cannot send empty command.');
      return;
  }

  if (websocket && wsStatus.value === 'open') {
    websocket.send(commandToSend);
    // Add the sent command to the message list for display
    wsMessages.value.push(`<span class="text-neutral-500">> ${commandToSend}</span>`);
  } else {
    console.warn('WebSocket is not open. Queuing command:', commandToSend);
    pendingCommands.value.push(commandToSend);
    // Add the queued command to the message list for display with an indicator
    wsMessages.value.push(`<span class="text-yellow-600">[Queued] > ${commandToSend}</span>`);
    // Provide feedback that it's queued
    // Note: Avoid adding too many system messages if connection flickers
    // wsMessages.value.push('<span class="text-yellow-500">[System] Command queued. Will send upon reconnection.</span>');
  }

  commandInput.value = '';
  // Ensure console scrolls after adding message (queued or sent)
  scrollToBottom();
};

// Watch for new messages and scroll down
watch(wsMessages, async () => {
  await scrollToBottom(); // Use the reusable scroll function
}, { deep: true });

// --- Function to fetch service status ---
const fetchServiceStatus = async () => {
    if (!serviceName.value) return;
    // Only show loading indicator on the initial load (when status is null)
    if (!serviceStatus.value && statusError.value !== 'offline') { // Don't show loading if known to be offline
        statusLoading.value = true;
    }
    statusError.value = null;
    try {
        const statusData = await $fetch<StatusResponse>(`/api/status/${encodeURIComponent(serviceName.value)}`);
        const previousPid = serviceStatus.value?.pid;
        serviceStatus.value = statusData;

        // --- Update Client-Side Uptime Base ---
        // Reset if PID changed or if it's the first fetch
        if (clientUptimeBaseTimestamp.value === null || statusData.pid !== previousPid) {
            const newUptime = Number(statusData.uptime);
            if (!isNaN(newUptime)) {
                clientUptimeBaseSeconds.value = newUptime;
                clientUptimeBaseTimestamp.value = Date.now();
                startClientTicker(); // Start or ensure the ticker is running
            } else {
                console.warn('Received invalid uptime value:', statusData.uptime);
                stopClientTicker(); // Stop ticker if uptime is invalid
            }
        }

    } catch (err: any) {
        // Check if the error is a 404, indicating the server might be offline
        if (err?.response?.status === 404) {
            console.log(`[Status Fetch] Service '${serviceName.value}' status endpoint returned 404. Assuming offline.`);
            serviceStatus.value = null; // Clear status
            statusError.value = 'offline'; // Set specific state for offline
            stopStatusPolling(); // Stop polling if server is offline
            stopClientTicker(); // Stop client ticker if server is offline
        } else {
            // Handle other errors as before
            console.error('Error fetching service status:', err);
            statusError.value = err.data?.message || 'Failed to fetch status.';
            serviceStatus.value = null; // Clear old status on error
        }
    } finally {
        statusLoading.value = false;
    }
};

// --- Function to start polling for status ---
const startStatusPolling = () => {
    if (statusInterval) clearInterval(statusInterval); // Clear existing interval if any
    statusInterval = setInterval(fetchServiceStatus, 5000); // Fetch every 5 seconds
};

// --- Function to stop polling for status ---
const stopStatusPolling = () => {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
};

// --- Function to send control actions ---
const sendControlAction = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
  if (!serviceName.value || controlLoading.value) return;

  controlLoading.value = action;
  controlError.value = null;
  controlSuccess.value = null;

  try {
    const response = await $fetch<ControlResponse>(`/api/control/${encodeURIComponent(serviceName.value)}/${action}`, {
      method: 'POST',
    });
    controlSuccess.value = response.message || `Action '${action}' successfully initiated.`;
    // Optionally: Refresh status after a short delay, especially after start/stop
    if (action === 'start' || action === 'stop' || action === 'restart') {
      setTimeout(fetchServiceStatus, 1500); // Refresh status after 1.5 seconds
    }
    // If started or restarted successfully, ensure polling is active
    if (action === 'start' || action === 'restart') {
        await fetchServiceStatus(); // Fetch status immediately
        startStatusPolling(); // Resume/start polling
    }
    // Clear success message after a few seconds
    setTimeout(() => controlSuccess.value = null, 4000);
  } catch (err: any) {
    console.error(`Error sending control action '${action}':`, err);
    controlError.value = err.data?.statusMessage || `Failed to execute action '${action}'.`;
    // Clear error message after a few seconds
    setTimeout(() => controlError.value = null, 5000);
  } finally {
    controlLoading.value = null;
  }
};

// --- Function to fetch flags --- (New)
const fetchFlags = async () => {
    if (!serviceName.value) return;
    flagsLoading.value = true;
    flagsError.value = null;
    try {
        serviceFlags.value = await $fetch<ServiceFlags>(`/api/flags/${encodeURIComponent(serviceName.value)}`);
    } catch (err: any) {
        console.error('Error fetching service flags:', err);
        flagsError.value = err.data?.statusMessage || 'Failed to load service flags.';
        serviceFlags.value = null; // Clear flags on error
    } finally {
        flagsLoading.value = false;
    }
};

// --- New Function to Parse TPS String --- (Rewritten AGAIN for fixed line numbers)
const parseTpsString = (rawTps: string | null): ParsedTpsData | null => {
  if (!rawTps) return null;

  // Split into lines based on the timestamp pattern, trimming each part
  const lineDelimiterRegex = /(\[\d{2}:\d{2}:\d{2}\]\s+\[[^\]]+\]:\s*)/;
  // Split by the regex. This keeps the delimiter in the results, but we filter empty strings and trim.
  // We also remove the first element if it's empty (string before the first delimiter)
  let lines = rawTps.split(lineDelimiterRegex).map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length > 0 && !lines[0].startsWith('[')) { // Check if first element is not a delimiter
      lines = lines.slice(1); // Remove the part before the first delimiter if it exists
  }

  // Now, 'lines' should contain pairs of [delimiter, content], or just [content] if split works differently. Let's normalize.
  // We want an array where each element is the content *after* the timestamp prefix.
  const contentLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
      // If the split includes delimiters, the content is after it
      if (lineDelimiterRegex.test(lines[i]) && i + 1 < lines.length) {
          contentLines.push(lines[i + 1]);
          i++; // Skip the next element which is the content
      } else if (!lineDelimiterRegex.test(lines[i])) {
          // If the split removed delimiters, this element is content
          contentLines.push(lines[i]);
      }
  }

  const data: ParsedTpsData = { tps: null, tickDuration: null, cpuUsage: null };

  // Check if we have enough lines *after* splitting by timestamp
  if (contentLines.length < 5) { // Use contentLines count
    console.warn(`Expected at least 5 logical lines after timestamp split, but got ${contentLines.length}. Raw:`, rawTps);
    return null;
  }

  try {
    // Parse TPS line (Expected: contentLines[1] - the content of the *second* logical line)
    const tpsLineContent = contentLines[1];
    if (tpsLineContent) {
      // Regex updated: No longer expect timestamp prefix here
      const tpsMatch = tpsLineContent.match(/^\s*\[⚡]\s*([\d.*]+),\s*([\d.*]+),\s*([\d.*]+),\s*([\d.*]+),\s*([\d.*]+)/);
      if (tpsMatch) {
        data.tps = {
          '5s': tpsMatch[1],
          '10s': tpsMatch[2],
          '1m': tpsMatch[3],
          '5m': tpsMatch[4],
          '15m': tpsMatch[5],
        };
      } else {
         console.warn("Could not parse TPS values from 2nd line:", tpsLineContent);
      }
    } else {
        console.warn("Second line (for TPS) is unexpectedly empty or undefined.");
    }

    // Parse Tick Duration line (Expected: contentLines[4] - the content of the *fifth* logical line)
    const tickLineContent = contentLines[4];
    if (tickLineContent) {
      // Match: [⚡]  0.0/0.0/0.1/0.2;  0.0/0.0/0.1/59.2
      // Extract content after [⚡]
      // Regex updated: No longer expect timestamp prefix
      const tickMatchResult = tickLineContent.match(/^\s*\[⚡]\s*(.*)/);
      if (tickMatchResult && tickMatchResult[1]) {
          const tickDataPart = tickMatchResult[1].trim();
          const tickParts = tickDataPart.split(';').map(part => part.trim());

          if (tickParts.length === 2) {
              // Match the four slash-separated values in each part
              const tick10sMatch = tickParts[0].match(/^([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)$/);
              const tick1mMatch = tickParts[1].match(/^([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)$/);

              if (tick10sMatch && tick1mMatch) {
                  data.tickDuration = {
                      '10s': { min: tick10sMatch[1], med: tick10sMatch[2], p95: tick10sMatch[3], max: tick10sMatch[4] },
                      '1m': { min: tick1mMatch[1], med: tick1mMatch[2], p95: tick1mMatch[3], max: tick1mMatch[4] },
                  };
              } else {
                  console.warn("Could not parse tick duration values from 5th line parts:", tickParts);
              }
          } else {
              console.warn("Could not split 5th tick duration line into two parts after '[⚡]':", tickDataPart);
          }
      } else {
          console.warn("Could not extract data after '[⚡]' from 5th line:", tickLineContent);
      }
    } else {
         console.warn("Fifth line (for Tick Duration) is unexpectedly empty or undefined.");
    }

  } catch (parseError) {
    console.error("Error parsing TPS string:", parseError, "Raw string:", rawTps);
    return null; // Return null if parsing fails catastrophically
  }

  // Return null if no data was successfully parsed
  if (!data.tps && !data.tickDuration) {
    console.warn("Could not parse any meaningful data from TPS string (lines 2 & 5):", rawTps);
    return null;
  }

  return data;
};

// --- Function to fetch TPS data --- (Updated)
const fetchTpsData = async () => {
    if (!serviceName.value || !serviceFlags.value?.sparktps) {
        // Don't fetch if flag isn't true or service name missing
        tpsResult.value = null;
        return; 
    }
    // Only show loading indicator on first load for TPS
    if (tpsResult.value === null && tpsError.value === null) {
        tpsLoading.value = true;
    }
    tpsError.value = null;
    try {
        // Fetch the raw string response
        const data = await $fetch<TpsResultResponse>(`/api/tps-results/${encodeURIComponent(serviceName.value)}`);
        // Parse the raw string
        const parsedData = parseTpsString(data.tps);
        if (parsedData) {
            tpsResult.value = parsedData; // Store the parsed object
        } else if (data.tps) {
            // If parsing failed but we got a string, show an error
            tpsError.value = 'Failed to parse TPS data format.';
            tpsResult.value = null;
        } else {
            // If the raw string was null/empty
            tpsResult.value = null; // Clear result
            // Optionally set a specific state if needed, e.g., tpsError.value = 'No TPS data received.'
        }
    } catch (err: any) {
        console.error('Error fetching TPS data:', err);
        if (err?.response?.status === 404) {
            tpsError.value = 'TPS data not yet available from poller.';
        } else {
            tpsError.value = err.data?.statusMessage || 'Failed to load TPS data.';
        }
        tpsResult.value = null; // Clear result on error
    } finally {
        tpsLoading.value = false;
    }
};

// --- Function to enable TPS tracking --- (New)
const enableTpsTracking = async () => {
    if (!serviceName.value || enableTpsLoading.value) return;
    enableTpsLoading.value = true;
    flagsError.value = null; // Clear previous flag errors
    try {
        const response = await $fetch<{ success: boolean, updatedFlags: ServiceFlags }>(`/api/flags/${encodeURIComponent(serviceName.value)}`, {
            method: 'POST',
            body: { sparktps: true }
        });
        if (response.success) {
            serviceFlags.value = response.updatedFlags; // Update local state immediately
            // Watcher will handle starting the polling
        } else {
             throw new Error('API reported failure.'); // Should not happen with current backend but good practice
        }
    } catch (err: any) {
        console.error('Error enabling TPS tracking:', err);
        flagsError.value = err.data?.statusMessage || 'Failed to enable TPS tracking.';
        // Optionally reset the flag state if needed, though watcher handles polling based on current state
        // await fetchFlags(); // Or refetch to be sure
    } finally {
        enableTpsLoading.value = false;
    }
};

// --- Watcher for Spark TPS Flag --- (New)
watch(() => serviceFlags.value?.sparktps, (isSparkTpsEnabled, wasEnabled) => {
    if (isSparkTpsEnabled) {
        // Flag is enabled, start polling
        tpsError.value = null; // Clear previous errors
        fetchTpsData(); // Fetch immediately
        if (tpsPollingInterval) clearInterval(tpsPollingInterval); // Clear old interval just in case
        tpsPollingInterval = setInterval(fetchTpsData, TPS_POLL_INTERVAL_MS);
    } else {
        // Flag is disabled or flags are null, stop polling
        if (tpsPollingInterval) {
            clearInterval(tpsPollingInterval);
            tpsPollingInterval = null;
        }
        // Clear TPS data when disabled
        tpsResult.value = null;
        tpsLoading.value = false;
        tpsError.value = null;
    }
}, { immediate: false }); // Don't run immediately, let fetchFlags populate first

// --- Function to start the client-side ticker ---
const startClientTicker = () => {
   if (clientTickerInterval) return; // Already running
   clientTickerInterval = setInterval(() => {
       clientSideTicker.value++; // Increment to trigger computed update
   }, 1000);
};

// --- Function to stop the client-side ticker ---
const stopClientTicker = () => {
   if (clientTickerInterval) {
       clearInterval(clientTickerInterval);
       clientTickerInterval = null;
       clientUptimeBaseSeconds.value = null;
       clientUptimeBaseTimestamp.value = null;
   }
};

onMounted(() => {
  if (serviceName.value) {
    fetchInitialData(); // <-- Call the new combined fetch function
    relayWsUrlDisplay.value = `wss://${window.location.host}/api/ws/relay/${encodeURIComponent(serviceName.value)}`;
  } else {
    error.value = 'Service name not provided in URL.';
    isLoading.value = false;
  }
});

onUnmounted(() => {
  if (websocket) {
    const wsInstance = websocket; // Capture instance before setting to null
    websocket = null; // Prevent reconnection attempts in onclose
    wsInstance.close(1000, 'Component unmounted'); // Close cleanly
  }
  stopStatusPolling(); // Stop fetching status when leaving the page
  stopClientTicker(); // Stop client ticker when leaving the page
  // Stop TPS polling when leaving the page (New)
  if (tpsPollingInterval) {
    clearInterval(tpsPollingInterval);
    tpsPollingInterval = null;
  }
});

</script>

<template>
  <div class="p-6 max-w-7xl mx-auto text-neutral-300">
    <h1 class="text-2xl font-semibold mb-4 text-neutral-100">
      <template v-if="service?.cleanName">
        <span class="font-medium text-neutral-100">{{ service.cleanName }}</span>
        <span class="ml-2 font-normal text-sm text-neutral-500">({{ serviceName }})</span>
      </template>
      <template v-else>
        <span class="font-medium text-neutral-400">{{ serviceName }}</span>
      </template>
    </h1>

    <!-- Flex container for columns - Updated for responsive layout -->
    <div class="flex flex-col lg:flex-row space-y-6 lg:space-y-0 lg:space-x-6">

      <!-- Main content column (Full width by default, 2/3 on lg+) -->
      <div class="w-full lg:w-2/3">
        <div v-if="isLoading" class="flex items-center text-neutral-400">
          <svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Loading service details...</span>
        </div>
        <div v-else-if="error" class="bg-red-900/30 border-l-4 border-red-600 text-red-300 p-4 mb-4" role="alert">
          <p class="font-bold">Error</p>
          <p>{{ error }}</p>
        </div>
        <div v-else-if="service" class="space-y-4">
          <!-- Console Output -->
          <div>
              <h2 class="text-lg font-semibold mb-2 text-neutral-200">Live Console Output</h2>
              <div
                ref="consoleOutputRef"
                class="w-full h-[30rem] bg-neutral-800 text-neutral-200 p-3 rounded-md overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-mono text-sm border border-neutral-700 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800"
              >
                <div v-if="historicalLogs.length > 0" class="text-neutral-400 italic opacity-50 mb-2 pb-2 border-b border-dashed border-neutral-600">
                  <div v-for="(log, index) in historicalLogs" :key="`hist-${index}`" v-html="log"></div>
                  <div class="mt-1">--- End of historical logs ---</div>
                </div>
                <div v-if="wsMessages.length === 0" class="italic" :class="{
                    'text-neutral-500 animate-pulse': wsStatus === 'open',
                    'text-neutral-600': wsStatus !== 'open' // Darker color when not open
                }">
                    <template v-if="wsStatus === 'open'">Waiting for messages...</template>
                    <template v-else-if="wsStatus === 'connecting'">Attempting connection...</template>
                    <template v-else>Not connected.</template> <!-- Covers 'closed' and 'error' -->
                </div>
                <div v-for="(msg, index) in wsMessages" :key="index" v-html="msg"></div>
              </div>
          </div>

          <!-- Command Input - Directly below console -->
          <div class="mt-3">
            <label for="commandInput" class="sr-only">Send Command</label> <!-- Screen reader only label -->
            <div class="flex space-x-2">
              <input
                id="commandInput"
                v-model="commandInput"
                type="text"
                placeholder="Enter command..."
                class="flex-grow px-3 py-2 bg-neutral-700 border border-neutral-600 text-neutral-200 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-500 focus:border-neutral-500 sm:text-sm placeholder-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                @keyup.enter="sendCommand"
              />
              <button
                @click="sendCommand"
                class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-neutral-100 bg-neutral-600 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                :disabled="!commandInput.trim()"
              >
                Send
              </button>
            </div>
          </div>

        </div>
        <div v-else class="text-neutral-500 mt-4">
            <p>Service details could not be loaded.</p>
        </div>

        <NuxtLink to="/" class="mt-6 inline-block text-neutral-400 hover:text-neutral-200 hover:underline transition duration-150 ease-in-out">
            &larr; Back to Server List
        </NuxtLink>
      </div> <!-- End Main content column -->

      <!-- Right sidebar column (Full width by default, 1/3 on lg+) -->
      <div class="w-full lg:w-1/3 bg-neutral-800/50 rounded-md space-y-6 p-4"> <!-- Added padding -->
        <!-- Control Buttons -->
        <div>
            <h3 class="text-lg font-semibold text-neutral-200 mb-3 border-b border-neutral-700 pb-2">Server Control</h3>
            <div class="grid grid-cols-2 gap-2 mb-3">
                <button
                    @click="sendControlAction('start')"
                    :disabled="!!controlLoading"
                    class="inline-flex justify-center items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded shadow-sm text-neutral-100 bg-neutral-700 hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                >
                    <svg v-if="controlLoading === 'start'" class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ controlLoading === 'start' ? 'Starting...' : 'Start' }}
                </button>
                <button
                    @click="sendControlAction('stop')"
                    :disabled="!!controlLoading"
                    class="inline-flex justify-center items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded shadow-sm text-neutral-100 bg-neutral-700 hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                 >
                    <svg v-if="controlLoading === 'stop'" class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ controlLoading === 'stop' ? 'Stopping...' : 'Stop' }}
                </button>
                <button
                    @click="sendControlAction('restart')"
                    :disabled="!!controlLoading"
                    class="inline-flex justify-center items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded shadow-sm text-neutral-100 bg-neutral-700 hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                >
                    <svg v-if="controlLoading === 'restart'" class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ controlLoading === 'restart' ? 'Restarting...' : 'Restart' }}
                </button>
                <button
                    @click="sendControlAction('kill')"
                    :disabled="!!controlLoading"
                    class="inline-flex justify-center items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-red-600/50 hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                >
                    <svg v-if="controlLoading === 'kill'" class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ controlLoading === 'kill' ? 'Killing...' : 'Kill' }}
                </button>
            </div>
            <!-- Control Action Status Feedback -->
            <div v-if="controlSuccess" class="mt-2 text-xs text-green-400 bg-green-900/30 p-2 rounded border border-green-700/50 text-center transition-opacity duration-300 ease-in-out">
                {{ controlSuccess }}
            </div>
            <div v-if="controlError" class="mt-2 text-xs text-red-400 bg-red-900/30 p-2 rounded border border-red-700/50 text-center transition-opacity duration-300 ease-in-out">
                {{ controlError }}
            </div>
        </div>

        <!-- MOVED: TPS Data Section - Should be IMMEDIATELY below control buttons/status -->
        <div v-if="!flagsLoading && !flagsError && serviceFlags?.sparktps" class="text-sm text-neutral-400 space-y-3 mt-4"> <!-- Added mt-4 for spacing -->
            <!-- REMOVED TPS Header -->
            <div v-if="tpsLoading && !tpsResult" class="flex items-center text-neutral-500 text-xs">
                <svg class="animate-spin -ml-0.5 mr-1.5 h-4 w-4 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Loading TPS...</span>
            </div>
             <div v-else-if="tpsError" class="text-red-400 text-xs italic border border-red-700/50 bg-red-900/20 p-2 rounded">
               {{ tpsError }}
             </div>
            <!-- Display Parsed TPS Data -->
            <div v-else-if="tpsResult" class="space-y-3 text-xs bg-neutral-700/40 border border-neutral-600/50 rounded p-2 font-mono">
                <!-- TPS Section -->
                <div v-if="tpsResult.tps">
                    <p class="text-neutral-400 font-medium mb-1">TPS <span class="text-neutral-500 font-normal">(5s, 10s, 1m, 5m, 15m)</span>:</p>
                    <p>
                        <code class="bg-neutral-600/50 px-1 rounded">*{{ tpsResult.tps['5s'] }}</code>,
                        <code class="bg-neutral-600/50 px-1 rounded">*{{ tpsResult.tps['10s'] }}</code>,
                        <code class="bg-neutral-600/50 px-1 rounded">*{{ tpsResult.tps['1m'] }}</code>,
                        <code class="bg-neutral-600/50 px-1 rounded">*{{ tpsResult.tps['5m'] }}</code>,
                        <code class="bg-neutral-600/50 px-1 rounded">*{{ tpsResult.tps['15m'] }}</code>
                    </p>
                </div>
                <!-- Tick Duration Section -->
                <div v-if="tpsResult.tickDuration">
                    <p class="text-neutral-400 font-medium mb-1">Tick (ms) <span class="text-neutral-500 font-normal">(min/med/95%/max)</span>:</p>
                    <p>
                        <span class="text-neutral-500">10s:</span>
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['10s'].min }}</code>/
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['10s'].med }}</code>/
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['10s'].p95 }}</code>/
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['10s'].max }}</code>
                    </p>
                     <p>
                        <span class="text-neutral-500">1m:</span>&nbsp;
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['1m'].min }}</code>/
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['1m'].med }}</code>/
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['1m'].p95 }}</code>/
                        <code class="bg-neutral-600/50 px-1 rounded">{{ tpsResult.tickDuration['1m'].max }}</code>
                    </p>
                </div>
                 <!-- CPU Usage Section -->
                 <!-- REMOVED CPU DISPLAY -->
            </div>
            <!-- Fallback if parsing fails or no data -->
            <div v-else class="text-neutral-500 text-xs italic">
                Waiting for TPS data...
            </div>
        </div>

        <!-- Simplified Service Info -->
        <div v-if="service && !isLoading && !error" class="text-sm text-neutral-400 space-y-3">
             <h3 class="text-lg font-semibold text-neutral-200 mb-3 border-b border-neutral-700 pb-2">Connection Info</h3>
             <p>
               Relaying via: <br>
               <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs inline-block mt-1 break-all">{{ relayWsUrlDisplay }}</code>
             </p>
             <p>
               Target: <br>
               <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs inline-block mt-1">ws://{{ service.address }}:8080/</code>
             </p>
             <p>
               Status Endpoint: <br>
               <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs inline-block mt-1">http://{{ service.address }}:8081/status</code>
             </p>
             <div class="flex items-center space-x-2 pt-2">
                <span class="font-medium text-neutral-300">Relay Status:</span>
                <span class="px-2 py-0.5 rounded-full text-xs font-medium border" :class="{
                  'bg-yellow-700/20 text-yellow-300 border-yellow-700/50': wsStatus === 'connecting',
                  'bg-green-700/20 text-green-300 border-green-700/50': wsStatus === 'open',
                  'bg-red-700/20 text-red-300 border-red-700/50': wsStatus === 'error',
                  'bg-neutral-700/30 text-neutral-400 border-neutral-700/50': wsStatus === 'closed',
                }">
                  {{ wsStatus }}
                </span>
              </div>
          </div>
          <div v-else-if="!isLoading" class="text-neutral-500 italic text-sm p-4">
            Connection info unavailable.
          </div>

          <!-- Service Status Section -->
          <div v-if="!isLoading && service" class="mt-6 text-sm text-neutral-400 space-y-3">
              <h3 class="text-lg font-semibold text-neutral-200 mb-3 border-b border-neutral-700 pb-2">Service Status</h3>
              <div v-if="statusLoading" class="flex items-center text-neutral-500 text-xs">
                <svg class="animate-spin -ml-0.5 mr-1.5 h-4 w-4 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Loading status...</span>
              </div>
              <div v-else-if="statusError === 'offline'" class="text-red-400 text-sm font-medium italic">
                Server Offline
              </div>
              <div v-else-if="statusError" class="text-red-400 text-xs italic">
                Error loading status: {{ statusError }}
              </div>
              <div v-else-if="serviceStatus" class="space-y-2">
                <p>CPU: <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs">{{ serviceStatus.cpu }}%</code></p>
                <p>Memory: <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs">{{ serviceStatus.memory }} MB</code></p>
                <p>PID: <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs">{{ serviceStatus.pid }}</code></p>
                <p>Uptime: <code class="bg-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded text-xs">{{ formattedUptime }}</code></p>
              </div>
              <div v-else class="text-neutral-500 text-xs italic">
                No status data available.
              </div>
              <div class="pt-3">
                <!-- TPS Section - Conditional Display (New) -->
                <div v-if="flagsLoading" class="flex items-center text-neutral-500 text-xs">
                   <svg class="animate-spin -ml-0.5 mr-1.5 h-4 w-4 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   <span>Loading flags...</span>
                </div>
                <div v-else-if="flagsError" class="text-red-400 text-xs italic border border-red-700/50 bg-red-900/20 p-2 rounded">
                  Error loading flags: {{ flagsError }}
                </div>
                <!-- REMOVED TPS Display Block (moved up) -->
                <button
                  v-else-if="!serviceFlags?.sparktps" 
                  @click="enableTpsTracking"
                  :disabled="enableTpsLoading"
                  class="w-full inline-flex justify-center items-center px-3 py-1.5 border border-neutral-600 text-xs font-medium rounded shadow-sm text-neutral-300 bg-neutral-700 hover:bg-neutral-600 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                >
                   <svg v-if="enableTpsLoading" class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-neutral-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   {{ enableTpsLoading ? 'Enabling...' : 'Track TPS [Requires spark!]' }}
                </button>

                <!-- Existing Discord Bot Button -->
                <button
                  class="w-full mt-2 inline-flex justify-center items-center px-3 py-1.5 border border-neutral-600 text-xs font-medium rounded shadow-sm text-neutral-300 bg-neutral-700 hover:bg-neutral-600 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                  disabled
                >
                  Configure Discord Bot
                </button>
              </div>
            </div>

        </div>

    </div> <!-- End Flex container -->
  </div>
</template>

<style>
/* Custom scrollbar styles adapted for neutral theme */
.scrollbar-thin::-webkit-scrollbar {
  width: 8px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: #262626; /* neutral-800 */
  border-radius: 10px;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: #525252; /* neutral-600 */
  border-radius: 10px;
  border: 2px solid #262626; /* neutral-800 */
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background-color: #737373; /* neutral-500 */
}
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #525252 #262626; /* neutral-600 neutral-800 */
}
</style> 