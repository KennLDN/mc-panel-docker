import { useStorage } from '#imports';
import type { DiscoveredService } from '~/server/utils/mdnsUtils';

const STORAGE_KEY = 'discovered';
const STORAGE_BASE = 'minecraft_services';

// Interface for the expected response from the target service's /rcon endpoint
interface RconTargetResponse {
  response: string;
}

/**
 * Sends an RCON command to a target service via its HTTP API endpoint.
 * @param serviceName The name of the target service.
 * @param command The RCON command string to send.
 * @returns The response string from the RCON command execution.
 * @throws An error if the service is not found, the command is empty, 
 *         or communication with the target service fails.
 */
export async function sendProxiedRconCommand(serviceName: string, command: string): Promise<string> {
  if (!serviceName) {
    throw new Error('[sendProxiedRconCommand] Service name is required.');
  }
  if (!command || command.trim() === '') {
      throw new Error('[sendProxiedRconCommand] Command cannot be empty.');
  }

  // Retrieve service details from storage
  const storage = useStorage(STORAGE_BASE);
  const currentServices = (await storage.getItem<DiscoveredService[]>(STORAGE_KEY)) || [];
  const service = currentServices.find(s => s.name === serviceName);

  if (!service || !service.address) {
    // Throw a specific error type or message that the API handler can catch
    const notFoundError = new Error(`Service '${serviceName}' not found or its address is unavailable.`);
    (notFoundError as any).statusCode = 404; // Add status code for API handler
    throw notFoundError;
  }

  // Construct the target URL
  const targetRconUrl = `http://${service.address}:8081/rcon`;

  try {
    console.log(`[RconUtils] Sending command to '${serviceName}' at: ${targetRconUrl}`);
    // Send the command to the target service
    const response = await $fetch<RconTargetResponse>(targetRconUrl, {
      method: 'POST',
      body: { command: command }, // Send JSON body { "command": "..." }
      responseType: 'json',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 15000, // 15-second timeout for RCON commands
    });

    // Validate and extract the response string
    const rconResponse = response?.response;
    if (typeof rconResponse !== 'string') {
      console.error(`[RconUtils] Unexpected response structure from '${serviceName}':`, response);
      // Throw an error indicating bad response from upstream
      const badResponseError = new Error(`Received unexpected response structure from the target service '${serviceName}'.`);
      (badResponseError as any).statusCode = 502; // Bad Gateway
      throw badResponseError;
    }

    console.log(`[RconUtils] Successfully received RCON response from '${serviceName}'.`);
    return rconResponse;

  } catch (error: any) {
    // Log and re-throw the error, potentially enriching it
    console.error(`[RconUtils] Failed to send RCON command to '${serviceName}' at ${targetRconUrl}:`, error);

    // Create a new error to ensure consistent structure for the API handler
    const upstreamMessage = error?.data?.message || error?.data?.response || error?.message || 'Failed to communicate with the target service.';
    const errorMessage = `Failed to send RCON command to target service '${serviceName}'. Error: ${upstreamMessage}`;
    const fetchError = new Error(errorMessage);
    // Preserve status code if available from $fetch error or use 502/original
    (fetchError as any).statusCode = error?.response?.status || error?.statusCode || 502;
    (fetchError as any).originalError = error; // Keep original error context if needed
    throw fetchError;
  }
} 