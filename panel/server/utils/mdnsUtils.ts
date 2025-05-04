import { Service } from 'bonjour-service';
import { useStorage } from 'nitropack/runtime';
import net from 'net'; // Import net here as checkServiceHealth uses it
import process from 'process';

// Re-export or define the interface here for shared use
export interface DiscoveredService {
  name: string;
  cleanName?: string | null;
  port: number;
  address: string;
  status?: 'up' | 'down'; // Add status field
}

const TARGET_SUBNET = process.env.TARGET_SUBNET || '172.50.0.';
const STORAGE_KEY = 'discovered';
const STORAGE_BASE = 'minecraft_services';

/**
 * Processes a raw mDNS service object.
 * Checks if it's in the target subnet and has necessary info.
 * @param service The raw service object from bonjour-service.
 * @returns A processed DiscoveredService object or null if invalid.
 */
export function processMdnsService(service: Service): DiscoveredService | null {
  const serviceAddress = service.addresses?.find((addr: string) => addr.startsWith(TARGET_SUBNET));

  if (serviceAddress && service.name && service.port) {
    return {
      name: service.name,
      port: service.port,
      address: serviceAddress,
    };
  }
  return null;
}

/**
 * Updates the central storage with a newly discovered/processed service.
 * Adds the service if it's new, or updates the existing entry if the name matches.
 * @param serviceInfo The processed service information to add/update.
 * @returns True if the storage was modified, false otherwise.
 */
export async function updateStoredServices(serviceInfo: DiscoveredService): Promise<boolean> {
  const storage = useStorage(STORAGE_BASE);
  let currentServices = (await storage.getItem(STORAGE_KEY)) as DiscoveredService[] || [];
  const existingServiceIndex = currentServices.findIndex(s => s.name === serviceInfo.name);

  let updated = false;
  if (existingServiceIndex === -1) {
    // Add new service
    currentServices.push(serviceInfo);
    console.log(`[Storage Update] Added service ${serviceInfo.name}`);
    updated = true;
  } else {
    // Update existing service (check if different before marking as updated)
    if (currentServices[existingServiceIndex].address !== serviceInfo.address || 
        currentServices[existingServiceIndex].port !== serviceInfo.port) {
      console.log(`[Storage Update] Updating service ${serviceInfo.name}`);
      currentServices[existingServiceIndex] = serviceInfo;
      updated = true;
    } else {
      // console.log(`[Storage Update] Service ${serviceInfo.name} already up-to-date.`);
    }
  }

  if (updated) {
    await storage.setItem(STORAGE_KEY, currentServices);
    // console.log('[Storage Update] Current services:', currentServices);
  }
  return updated;
}

/**
 * Checks TCP connection health for a service.
 */
export function checkServiceHealth(service: DiscoveredService): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 2000;
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); }); // Simplified error handling
    socket.connect(service.port, service.address);
  });
}

/**
 * Initializes the storage ensuring the discovered key exists as an array.
 */
export async function initializeServiceStorage() {
  const storage = useStorage(STORAGE_BASE);
  if (!(await storage.hasItem(STORAGE_KEY))) {
    await storage.setItem(STORAGE_KEY, []);
  }
} 