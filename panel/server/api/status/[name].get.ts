import { defineEventHandler, getRouterParam, createError } from 'h3';
import { useStorage } from '#imports'; // Use #imports for Nitro auto-imports
import type { DiscoveredService } from '~/server/utils/mdnsUtils';

// Define interface for the expected status response structure
interface StatusResponse {
  cpu: string;
  memory: string;
  pid: number;
  uptime: string;
}

const STORAGE_KEY = 'discovered';
const STORAGE_BASE = 'minecraft_services';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name');

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name is required',
    });
  }

  // Retrieve service details from storage
  const storage = useStorage(STORAGE_BASE);
  const currentServices = (await storage.getItem(STORAGE_KEY)) as DiscoveredService[] || [];
  const service = currentServices.find(s => s.name === name);

  if (!service) {
    throw createError({
      statusCode: 404,
      statusMessage: `Service '${name}' not found or details unavailable.`,
    });
  }

  // Construct the target URL for fetching status
  const targetStatusUrl = `http://${service.address}:8081/status`; // Changed endpoint

  try {
    console.log(`[API Status] Fetching status for '${name}' from: ${targetStatusUrl}`);
    // Fetch status from the target service expecting the specific JSON structure
    const response = await $fetch<StatusResponse>(targetStatusUrl, {
      method: 'GET',
      responseType: 'json',
      // Add timeout? e.g., timeout: 5000 // 5 seconds
    });

    console.log(`[API Status] Successfully fetched status for '${name}'.`);
    return response; // Return the entire status object
  } catch (error: any) {
    console.error(`[API Status] Failed to fetch status for '${name}' from ${targetStatusUrl}:`, error);
    // Check if the error is from $fetch (contains status) or another type
    const statusCode = error?.response?.status || 502; // 502 Bad Gateway if fetch failed
    const errorMessage = error?.data?.message || error?.message || 'Failed to communicate with the target service.';

    throw createError({
      statusCode: statusCode,
      statusMessage: `Failed to fetch status from the target service '${name}' at ${service.address}. Error: ${errorMessage}`,
    });
  }
}); 