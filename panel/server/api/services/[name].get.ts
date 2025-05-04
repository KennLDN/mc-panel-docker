import { defineEventHandler, createError } from 'h3';
import { useStorage } from 'nitropack/runtime';
import type { DiscoveredService } from '~/server/utils/mdnsUtils';

const DISCOVERY_STORAGE_KEY = 'discovered';
const CLEAN_NAMES_STORAGE_KEY = 'clean_names'; // Key for clean names
const STORAGE_BASE = 'minecraft_services';

export default defineEventHandler(async (event) => {
  const serviceName = event.context.params?.name;

  if (!serviceName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name parameter is required.',
    });
  }

  const storage = useStorage(STORAGE_BASE);

  // Fetch base service details
  const currentServices = (await storage.getItem(DISCOVERY_STORAGE_KEY)) as DiscoveredService[] || [];
  const targetServiceBase = currentServices.find(s => s.name === serviceName);

  if (!targetServiceBase) {
    throw createError({
      statusCode: 404,
      statusMessage: `Service '${serviceName}' not found in discovery list.`,
    });
  }

  // Fetch clean names
  const cleanNames = (await storage.getItem(CLEAN_NAMES_STORAGE_KEY)) as Record<string, string> || {};
  const cleanName = cleanNames[serviceName] || null;

  // Combine base details with clean name
  const targetService: DiscoveredService = {
    ...targetServiceBase,
    cleanName: cleanName,
  };

  return targetService;
}); 