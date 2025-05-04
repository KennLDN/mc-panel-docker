import { defineNitroPlugin, useStorage } from '#imports';
import type { NitroApp } from 'nitropack';
import { getServiceFlags, ServiceFlags } from '~/server/utils/flagsUtils';
import { sendProxiedRconCommand } from '~/server/utils/rconUtils';
import type { DiscoveredService } from '~/server/utils/mdnsUtils';
import type { Unwatch } from 'unstorage';

// --- In-memory storage for the latest TPS results --- 
// Format: Map<ServiceName, TpsResultString>
// This map is module-scoped and will persist as long as the server process is running.
export const latestTpsResults = new Map<string, string>();

const POLLING_INTERVAL_MS = 20 * 1000; // 20 seconds
const STORAGE_KEY_DISCOVERED = 'discovered';
const STORAGE_KEY_FLAGS = 'service_flags'; // Use the constant from flagsUtils if exported, otherwise define here
const STORAGE_BASE = 'minecraft_services';

let tpsPollInterval: NodeJS.Timeout | null = null;
let storageWatcherUnsubscriber: Unwatch | null = null;

/**
 * Checks if any currently discovered service needs TPS polling based on flags.
 */
async function checkPollingNeeded(): Promise<boolean> {
    const storage = useStorage(STORAGE_BASE);
    const currentServices = (await storage.getItem<DiscoveredService[]>(STORAGE_KEY_DISCOVERED)) || [];
    const allFlags = (await storage.getItem<Record<string, ServiceFlags>>(STORAGE_KEY_FLAGS)) || {};
    
    for (const service of currentServices) {
        if (service?.name && allFlags[service.name]?.sparktps) {
            console.log(`[Spark TPS Poller Check] Polling needed for: ${service.name}`);
            return true; // Found at least one service that needs polling
        }
    }
    console.log('[Spark TPS Poller Check] No services currently require polling.');
    return false; // No services need polling
}

/**
 * Fetches TPS for all services marked with sparktps: true
 * Also checks if polling should continue afterwards.
 */
async function pollSparkTpsAndManageInterval() {
    console.log('[Spark TPS Poller] Starting polling cycle...');
    const storage = useStorage(STORAGE_BASE);
    const currentServices = (await storage.getItem<DiscoveredService[]>(STORAGE_KEY_DISCOVERED)) || [];
    const allFlags = (await storage.getItem<Record<string, ServiceFlags>>(STORAGE_KEY_FLAGS)) || {}; // Get flags once per cycle
    let servicesPolled = 0;
    let pollingStillNeeded = false;

    for (const service of currentServices) {
        if (!service || !service.name) continue;

        try {
            // Use flags fetched at the start of the cycle
            const serviceFlags = allFlags[service.name]; 
            if (serviceFlags?.sparktps) {
                pollingStillNeeded = true; // Mark that at least one service needed polling this cycle
                servicesPolled++;
                console.log(`[Spark TPS Poller] Polling TPS for '${service.name}' (sparktps=true)...`);
                try {
                    const tpsResponse = await sendProxiedRconCommand(service.name, 'spark tps');
                    latestTpsResults.set(service.name, tpsResponse);
                    console.log(`[Spark TPS Poller] Successfully polled TPS for '${service.name}'.`);
                } catch (rconError: any) {
                    console.error(`[Spark TPS Poller] Failed to poll TPS for '${service.name}': ${rconError.message || rconError}`);
                    latestTpsResults.set(service.name, 'Error: Failed to fetch TPS');
                }
            }
        } catch (fetchError: any) {
            // Catch errors from the loop itself, though flag fetching is now outside
             console.error(`[Spark TPS Poller] Error processing service '${service.name}' in poll loop: ${fetchError.message || fetchError}`);
        }
    }
    console.log(`[Spark TPS Poller] Polling cycle finished. Checked ${currentServices.length} services, polled TPS for ${servicesPolled}.`);

    // Stop the interval if no services required polling *during this cycle*
    if (!pollingStillNeeded && tpsPollInterval) {
        console.log('[Spark TPS Poller] No services required polling this cycle. Stopping interval.');
        clearInterval(tpsPollInterval);
        tpsPollInterval = null;
        // Watcher will restart it if needed later
    }
}

/**
 * Starts the polling interval if it's not running and polling is needed.
 */
async function ensurePollingStarted() {
    if (tpsPollInterval) return; // Already running

    if (await checkPollingNeeded()) {
        console.log('[Spark TPS Poller] Polling is needed and interval not running. Starting interval.');
        // Run once immediately
        pollSparkTpsAndManageInterval().catch(err => {
            console.error('[Spark TPS Poller] Error during immediate poll on start:', err);
        });
        // Start the interval
        tpsPollInterval = setInterval(() => {
            pollSparkTpsAndManageInterval().catch(err => {
                console.error('[Spark TPS Poller] Error during scheduled poll:', err);
            });
        }, POLLING_INTERVAL_MS);
    } else {
        console.log('[Spark TPS Poller] Polling not currently needed, interval remains stopped.');
    }
}

// --- Nitro Plugin Definition --- 

export default defineNitroPlugin(async (nitroApp: NitroApp) => {
    console.log('[Spark TPS Poller] Initializing plugin...');
    const storage = useStorage(STORAGE_BASE);

    // --- Initial Check and Start --- 
    await ensurePollingStarted();

    // --- Storage Watcher --- 
    // Watch for changes to the flags file to dynamically start/stop polling
    try {
        // Ensure previous watcher is stopped if plugin re-initializes (e.g., HMR)
        if (storageWatcherUnsubscriber) {
            console.log('[Spark TPS Poller] Unsubscribing existing storage watcher.');
            await storageWatcherUnsubscriber();
            storageWatcherUnsubscriber = null;
        }

        console.log(`[Spark TPS Poller] Setting up storage watcher for key: ${STORAGE_BASE}:${STORAGE_KEY_FLAGS}`);
        storageWatcherUnsubscriber = await storage.watch(async (event, key: string) => {
            if (key === `${STORAGE_BASE}:${STORAGE_KEY_FLAGS}`) {
                console.log(`[Spark TPS Poller] Storage key '${key}' changed (${event}). Re-evaluating polling needs.`);
                await ensurePollingStarted(); 
            }
        });
        console.log('[Spark TPS Poller] Storage watcher setup complete.');
    } catch (watchError) {
        console.error('[Spark TPS Poller] Failed to set up storage watcher:', watchError);
        // Polling might still run based on initial check, but won't react to flag changes.
    }

    console.log('[Spark TPS Poller] Plugin initialization complete.');

    // Note: Interval cleanup on shutdown is tricky in Nitro plugins.
    // Unsubscribing the watcher on shutdown would also be ideal but lacks a standard hook.
}); 