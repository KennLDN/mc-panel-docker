import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3';
import { useStorage } from '#imports';
import type { DiscoveredService } from '~/server/utils/mdnsUtils';

const STORAGE_KEY = 'discovered';
const STORAGE_BASE = 'minecraft_services';
const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'kill'];

interface ControlResponse {
  message: string;
}

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name');
  const action = getRouterParam(event, 'action');

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name is required',
    });
  }

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid action. Allowed actions are: ${ALLOWED_ACTIONS.join(', ')}`,
    });
  }

  // Retrieve service details from storage
  const storage = useStorage(STORAGE_BASE);
  const currentServices = (await storage.getItem(STORAGE_KEY)) as DiscoveredService[] || [];
  const service = currentServices.find(s => s.name === name);

  if (!service || !service.address) {
    throw createError({
      statusCode: 404,
      statusMessage: `Service '${name}' not found or its address is unavailable.`,
    });
  }

  // Construct the target URL for the control action
  const targetControlUrl = `http://${service.address}:8081/control/${action}`;

  try {
    console.log(`[API Control] Sending '${action}' command for '${name}' to: ${targetControlUrl}`);
    // Send POST request to the target service's control endpoint
    const response = await $fetch.raw<ControlResponse>(targetControlUrl, {
      method: 'POST',
      // No body needed for these control actions based on the description
    });

    console.log(`[API Control] Successfully sent '${action}' command for '${name}'. Target responded with status ${response.status}.`);

    // Set the response status based on the target service's response
    setResponseStatus(event, response.status);
    // Return the message from the target service, or a default one if none provided
    return { message: response._data?.message || `Action '${action}' initiated successfully.` };

  } catch (error: any) {
    console.error(`[API Control] Failed to send '${action}' command for '${name}' to ${targetControlUrl}:`, error);

    // Extract status and message from the fetch error
    const statusCode = error?.response?.status || 502; // 502 Bad Gateway if fetch itself failed or target unreachable
    const upstreamMessage = error?.data?.message || error?.message || 'Failed to communicate with the target service.';

    // Re-throw an error that the Nuxt client will receive
    throw createError({
      statusCode: statusCode, // Use the status code from the upstream error if available
      statusMessage: `Failed to execute '${action}' on target service '${name}'. Error: ${upstreamMessage}`,
      data: error?.data // Forward any additional data from the error
    });
  }
}); 