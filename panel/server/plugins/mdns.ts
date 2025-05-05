import { Bonjour, Service, Browser } from 'bonjour-service';
import { useStorage } from 'nitropack/runtime';
// Import utilities AND helper functions
import {
  processMdnsService,
  updateStoredServices,
  checkServiceHealth,
  initializeServiceStorage
} from '../utils/mdnsUtils';
import type { DiscoveredService } from '../utils/mdnsUtils';
// Import the WebSocket manager functions
import {
  initializeTargetConnection,
  closeTargetConnection,
  shutdownManager // Import the shutdown function
} from '../utils/persistentWsManager';

let bonjourInstance: Bonjour | null = null;
let browserInstance: Browser | null = null;
let healthCheckInterval: NodeJS.Timeout | null = null;
const checkIntervalMs = 30000; // Check every 30 seconds

// Function to stop the discovery and health checks
export function stopMdnsDiscovery() {
  console.log('[mDNS Plugin] Stopping mDNS browser and health checks...');
  if (browserInstance) {
    browserInstance.stop();
    browserInstance = null;
  }
  if (bonjourInstance) {
    // bonjourInstance.destroy(); // Destroy might be too aggressive if shared
    bonjourInstance = null; // Release reference
  }
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  // Call the manager's shutdown here as well, just in case `close` hook doesn't fire
  // shutdownManager(); // Decided to keep this only in the 'close' hook for cleaner separation
}

// Function to start the discovery and health checks
export async function startMdnsDiscovery() {
  // Ensure any previous instances are stopped first
  stopMdnsDiscovery();

  console.log('[mDNS Plugin] Starting mDNS discovery for minecraft-control services...');
  await initializeServiceStorage(); // Ensure storage is ready
  const storage = useStorage('minecraft_services');

  bonjourInstance = new Bonjour();
  browserInstance = bonjourInstance.find({ type: 'minecraft-control' });

  browserInstance.on('up', async (service: Service) => {
    const serviceInfo = processMdnsService(service);
    if (serviceInfo) {
      console.log('[mDNS Plugin] Discovered service via mDNS:', serviceInfo);
      const updated = await updateStoredServices(serviceInfo);
      if (updated) {
        console.log('[mDNS Plugin] Storage updated via background discovery.');
        // Initialize connection for newly discovered or updated service
        console.log(`[mDNS Plugin] Initializing connection for discovered/updated service: ${serviceInfo.name}`);
        initializeTargetConnection(serviceInfo); // Use the manager
      }
    }
  });

  // TODO: Handle 'down' events from bonjour if available/reliable
  // browserInstance.on('down', async (service: Service) => { ... closeTargetConnection(service.name) ... });


  browserInstance.on('error', (err) => {
    console.error('[mDNS Plugin] Browser Error:', err);
    // Consider restart logic
  });

  // Start periodic health checks
  console.log(`[mDNS Plugin] Starting periodic health checks every ${checkIntervalMs / 1000} seconds...`);
  healthCheckInterval = setInterval(async () => {
    let currentServices = (await storage.getItem('discovered')) as DiscoveredService[] || [];
    if (currentServices.length === 0) return;

    const updatedServices = [...currentServices];
    let listChanged = false;

    const healthCheckPromises = updatedServices.map(async (service, index) => {
        // Store original status before check
        const originalStatus = updatedServices[index].status;
        try {
            const isHealthy = await checkServiceHealth(service);
            const newStatus = isHealthy ? 'up' : 'down';

            if (originalStatus !== newStatus) {
                updatedServices[index].status = newStatus;
                listChanged = true;
                console.log(`[mDNS Plugin] Service ${service.name} status changed: ${originalStatus} -> ${newStatus}`);

                // --- Integrate with WS Manager ---
                if (newStatus === 'up') {
                    console.log(`[mDNS Plugin] Health check OK: Initializing/Re-initializing connection for ${service.name}`);
                    initializeTargetConnection(service);
                } else { // newStatus === 'down'
                    console.log(`[mDNS Plugin] Health check FAILED: Closing connection for ${service.name}`);
                    closeTargetConnection(service.name);
                }
                // --- End Integration ---

            } else if (originalStatus === undefined) {
                 // Set initial status if it was never set
                 updatedServices[index].status = newStatus;
                 listChanged = true;
                 console.log(`[mDNS Plugin] Service ${service.name} initial status set to: ${newStatus}`);
                 // Initialize connection if initial status is 'up'
                 if (newStatus === 'up') {
                     initializeTargetConnection(service);
                 }
            }
        } catch (error) {
            console.error(`[mDNS Plugin] Error during health check for ${service.name}:`, error);
            const newStatus = 'down';
            if (updatedServices[index].status !== newStatus) {
                updatedServices[index].status = newStatus;
                listChanged = true;
                console.log(`[mDNS Plugin] Service ${service.name} status changed to: down (due to error)`);
                // --- Integrate with WS Manager ---
                 console.log(`[mDNS Plugin] Health check ERROR: Closing connection for ${service.name}`);
                 closeTargetConnection(service.name);
                 // --- End Integration ---
            }
        }
    });

    await Promise.allSettled(healthCheckPromises);

    if (listChanged) {
      console.log('[mDNS Plugin] Updating service list with statuses after health checks.');
      await storage.setItem('discovered', updatedServices);
    }
  }, checkIntervalMs);

  // Initialize connections for stored services *after* a short delay
  // to allow mDNS browser to start without contention.
  setTimeout(async () => {
      try {
          const initialServices = (await storage.getItem('discovered')) as DiscoveredService[] || [];
          console.log(`[mDNS Plugin] Initializing connections for ${initialServices.length} stored services (delayed)...`);
          initialServices.forEach(service => {
              if (service.status !== 'down') { // Only init if not known to be down
                  console.log(`[mDNS Plugin] Initializing connection on startup for: ${service.name}`);
                  initializeTargetConnection(service); // Use the manager
              }
          });
      } catch (error) {
          console.error("[mDNS Plugin] Error during delayed initial connection setup:", error);
      }
  }, 1000); // 1-second delay
}

// --- Nitro Plugin Definition ---
export default defineNitroPlugin(async (nitroApp) => {
  // Start discovery when the Nitro app initializes
  await startMdnsDiscovery();

  // Cleanup on server shutdown
  nitroApp.hooks.hook('close', () => {
    console.log('[mDNS Plugin] Nitro app closing, stopping discovery and shutting down WS manager.');
    stopMdnsDiscovery();
    shutdownManager(); // Call the manager's shutdown hook
  });
}); 