import { Bonjour, Service, Browser } from 'bonjour-service';
import { useStorage } from 'nitropack/runtime';
// Import utilities AND helper functions
import {
  processMdnsService,
  updateStoredServices,
  checkServiceHealth,
  initializeServiceStorage
} from '../utils/mdnsUtils';
import type { DiscoveredService } from '../utils/mdnsUtils'; // Import type only once

let bonjourInstance: Bonjour | null = null;
let browserInstance: Browser | null = null;
let healthCheckInterval: NodeJS.Timeout | null = null;
const checkIntervalMs = 30000; // Check every 30 seconds

// Function to stop the discovery and health checks
export function stopMdnsDiscovery() {
  console.log('Stopping mDNS browser and health checks...');
  if (browserInstance) {
    browserInstance.stop();
    browserInstance = null;
  }
  if (bonjourInstance) {
    bonjourInstance.destroy();
    bonjourInstance = null;
  }
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// Function to start the discovery and health checks
export async function startMdnsDiscovery() {
  // Ensure any previous instances are stopped first
  stopMdnsDiscovery(); 

  console.log('Starting mDNS discovery for minecraft-control services...');
  await initializeServiceStorage(); // Ensure storage is ready
  const storage = useStorage('minecraft_services');

  bonjourInstance = new Bonjour();
  browserInstance = bonjourInstance.find({ type: 'minecraft-control' });

  browserInstance.on('up', async (service: Service) => {
    const serviceInfo = processMdnsService(service);
    if (serviceInfo) {
      console.log('Discovered service:', serviceInfo);
      const updated = await updateStoredServices(serviceInfo);
      if (updated) {
        console.log('Storage updated via background discovery.');
      }
    }
  });

  browserInstance.on('error', (err) => {
    console.error('mDNS Browser Error:', err);
    // Consider attempting a restart after an error
    // stopMdnsDiscovery();
    // setTimeout(startMdnsDiscovery, 5000); // Example restart delay
  });

  // Start periodic health checks
  console.log(`Starting periodic health checks every ${checkIntervalMs / 1000} seconds...`);
  healthCheckInterval = setInterval(async () => {
    let currentServices = (await storage.getItem('discovered')) as DiscoveredService[] || [];
    if (currentServices.length === 0) return; // No services to check

    // Create a new array for mapping results to avoid race conditions if checks are very slow
    const updatedServices = [...currentServices]; 
    let listChanged = false;

    const healthCheckPromises = updatedServices.map(async (service, index) => {
        try {
            const isHealthy = await checkServiceHealth(service);
            const newStatus = isHealthy ? 'up' : 'down';
            // Check if status actually changed
            if (updatedServices[index].status !== newStatus) {
                updatedServices[index].status = newStatus;
                listChanged = true;
                console.log(`Service ${service.name} (${service.address}:${service.port}) status changed to: ${newStatus}`);
            } else {
                // Status remains the same, ensure it's set if it was undefined before
                if (updatedServices[index].status === undefined) {
                    updatedServices[index].status = newStatus;
                    listChanged = true; // Consider setting initial status as a change
                }
            }
        } catch (error) {
            // Handle potential errors from checkServiceHealth itself, though it should resolve false
            console.error(`Error during health check for ${service.name}:`, error);
            if (updatedServices[index].status !== 'down') {
                updatedServices[index].status = 'down';
                listChanged = true;
                console.log(`Service ${service.name} (${service.address}:${service.port}) status changed to: down (due to error)`);
            }
        }
    });

    // Wait for all checks to complete
    await Promise.allSettled(healthCheckPromises);

    // Save the updated list (including statuses) if any status changed
    if (listChanged) {
      console.log('Updating service list with statuses after health checks.');
      await storage.setItem('discovered', updatedServices);
    }
  }, checkIntervalMs);
}

// --- Nitro Plugin Definition ---
export default defineNitroPlugin(async (nitroApp) => {
  // Start discovery when the Nitro app initializes
  await startMdnsDiscovery();

  // Cleanup on server shutdown
  nitroApp.hooks.hook('close', () => {
    stopMdnsDiscovery();
  });
}); 