import { defineEventHandler } from 'h3';
import { useStorage } from 'nitropack/runtime';
// Adjust import path relative to the new location
import type { DiscoveredService } from '../../utils/mdnsUtils';

// Type for the clean name mapping
type CleanNameMap = Record<string, string>;

// Define the structure of the returned service info
interface ServiceInfo {
  name: string;
  cleanName: string | null;
}

export default defineEventHandler(async (event): Promise<ServiceInfo[]> => {
  const storage = useStorage('minecraft_services');

  // Get discovered services and clean names
  const services = (await storage.getItem<DiscoveredService[]>('discovered')) || [];
  const cleanNames = (await storage.getItem<CleanNameMap>('clean_names')) || {};

  // Map services to include their clean name
  const serviceInfoList = services.map(service => ({
    name: service.name,
    cleanName: cleanNames[service.name] || null // Get clean name or null if not set
  }));

  return serviceInfoList;
}); 