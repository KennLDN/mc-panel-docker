import { defineEventHandler, getRouterParam, readBody, createError, setResponseStatus } from 'h3';
import { setServiceFlag } from '~/server/utils/flagsUtils'; // Import the utility function
import type { ServiceFlags } from '~/server/utils/flagsUtils'; // Import the interface

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name');

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name is required',
    });
  }

  const body = await readBody(event);

  // Validate the input body - check for the specific flag we want to set
  if (typeof body?.sparktps !== 'boolean') {
      throw createError({
          statusCode: 400,
          statusMessage: 'Invalid request body. Expected { "sparktps": boolean }.',
      });
  }

  const newSparkTpsValue: boolean = body.sparktps;

  // Call the utility function to set the flag
  try {
      const updatedFlags = await setServiceFlag(name, 'sparktps', newSparkTpsValue);

      console.log(`[API Flags POST] Successfully updated flags for '${name}'.`);
      setResponseStatus(event, 200);
      return { success: true, updatedFlags: updatedFlags };

  } catch (error: any) {
      // Log the specific error from the utility function
      console.error(`[API Flags POST] Error updating flags for '${name}':`, error.message || error);
      throw createError({
          statusCode: 500,
          // Use the error message from the utility if available
          statusMessage: error.message || 'Failed to update service flags.',
      });
  }
}); 