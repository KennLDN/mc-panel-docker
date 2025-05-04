import { defineEventHandler, getRouterParam, createError } from 'h3';
import { useStorage } from '#imports'; // Use #imports for Nitro auto-imports
import type { DiscoveredService } from '~/server/utils/mdnsUtils';

// Define interface for the expected response structure from the internal service
interface ServerStateResponse {
  status: 'online' | 'inactive';
}

const STORAGE_KEY = 'discovered';
const STORAGE_BASE = 'minecraft_services';

export default defineEventHandler(async (event): Promise<'online' | 'inactive' | 'offline'> => {
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

  // Construct the target URL for fetching the server state
  const targetStateUrl = `http://${service.address}:8081/server-state`;

  try {
    console.log(`[API ServerState] Fetching state for '${name}' from: ${targetStateUrl}`);
    // Fetch state from the target service with a timeout
    const response = await $fetch<ServerStateResponse>(targetStateUrl, {
      method: 'GET',
      responseType: 'json',
      timeout: 2000, // 2-second timeout
    });

    // Validate the response structure
    if (response && (response.status === 'online' || response.status === 'inactive')) {
        console.log(`[API ServerState] Successfully fetched state for '${name}': ${response.status}`);
        return response.status;
    } else {
        console.warn(`[API ServerState] Received unexpected state response for '${name}':`, response);
        // Treat unexpected response structure as offline for consistency
        return 'offline';
    }

  } catch (error: any) {
    // Log different types of errors
    if (error.message && (error.message.includes('timeout') || error.message.includes('timed out'))) {
        console.log(`[API ServerState] Request for '${name}' timed out. Assuming offline.`);
    } else if (error?.response?.status) {
        console.log(`[API ServerState] Failed to fetch state for '${name}'. Status: ${error.response.status}. Assuming offline.`);
    } else {
        console.error(`[API ServerState] Failed to fetch state for '${name}' from ${targetStateUrl}:`, error.message || error);
    }
    // Treat any fetch error (timeout, 404, network error, etc.) as 'offline'
    return 'offline';
  }
}); 