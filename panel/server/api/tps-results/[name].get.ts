import { defineEventHandler, getRouterParam, createError } from 'h3';
// Import the in-memory map from the plugin
import { latestTpsResults } from '~/server/plugins/sparkTpsPoller';

// Define the expected response structure
interface TpsResultResponse {
  tps: string | null; // String containing the result, or null if not found/polled
  lastPolledTimestamp?: number; // Optional: Could add timestamp later if needed
}

export default defineEventHandler(async (event): Promise<TpsResultResponse> => {
  const name = getRouterParam(event, 'name');

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name parameter is required',
    });
  }

  // Retrieve the latest result from the in-memory map
  const tpsResult = latestTpsResults.get(name);

  if (tpsResult === undefined) {
      // We haven't polled this server (or it doesn't exist/doesn't have sparktps=true)
      // Return 404 to indicate no data available for this specific server
      throw createError({
          statusCode: 404,
          statusMessage: `No TPS data found for service '${name}'. It might not exist, have sparktps enabled, or hasn't been polled yet.`,
      });
  } else {
      // Return the found result (could be the TPS string or the error message)
      return { tps: tpsResult };
  }
}); 