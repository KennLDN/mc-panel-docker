import { defineEventHandler, createError, setResponseStatus } from 'h3';
import { useStorage } from '#imports';
import type { DiscoveredService } from '~/server/utils/mdnsUtils';

const STORAGE_KEY = 'discovered';
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

  // Get the current list of services
  let currentServices = (await storage.getItem<DiscoveredService[]>(STORAGE_KEY)) || [];
  const initialLength = currentServices.length;

  // Filter out the service to delete
  currentServices = currentServices.filter(s => s.name !== serviceName);

  // Check if any service was actually removed
  if (currentServices.length === initialLength) {
    throw createError({
      statusCode: 404,
      statusMessage: `Service '${serviceName}' not found.`,
    });
  }

  // Save the updated list back to storage
  await storage.setItem(STORAGE_KEY, currentServices);

  console.log(`[API Delete] Service '${serviceName}' removed.`);
  setResponseStatus(event, 204); // No Content success status
  return {}; // Return empty body for 204
}); 