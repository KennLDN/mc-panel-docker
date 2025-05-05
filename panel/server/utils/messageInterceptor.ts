import { Buffer } from 'buffer'; // Node.js Buffer
import { useStorage } from '#imports'; // Use #imports for Nitro auto-imports
import type { DiscoveredService } from '~/server/utils/mdnsUtils'; // For clearAll
import { getBridgeServiceConfig } from './bridgeState'; // <-- Import bridge config getter
import { sendToDiscord } from './discordWebhook'; // <-- Import Discord sender

// Define the structure for a single intercepted message (stored in JSON)
interface InterceptedMessage {
  timestamp: number;
  message: string; // Store string or base64 representation of buffer
  isBinary: boolean;
}

// Define the storage base and key prefix
const STORAGE_BASE = 'minecraft_services';
const STORAGE_KEY_PREFIX = 'intercepted:'; // Prefix for service-specific keys
const STORAGE_KEY_DISCOVERED = 'discovered'; // Key for the list of discovered services

// Limit the number of messages stored per service to prevent storage bloat
const MAX_MESSAGES_PER_SERVICE = 500;

/**
 * Generates the Nitro storage key for a specific service's intercepted messages.
 * @param serviceName The name of the service.
 * @returns The storage key string.
 */
function getStorageKey(serviceName: string): string {
    return `${STORAGE_KEY_PREFIX}${serviceName}`;
}

/**
 * Intercepts and stores an incoming WebSocket message for a specific service using Nitro storage.
 * Also checks for Minecraft chat messages to bridge to Discord.
 * @param serviceName The name of the service the message came from.
 * @param message The message content (string or Buffer).
 * @param isBinary Flag indicating if the message is binary.
 */
export async function interceptMessage(
  serviceName: string,
  message: Buffer | string,
  isBinary: boolean
): Promise<void> {
  try {
    const storage = useStorage(STORAGE_BASE);
    const storageKey = getStorageKey(serviceName);

    // Retrieve existing messages
    const currentMessages = (await storage.getItem<InterceptedMessage[]>(storageKey)) || [];

    // Prepare message content for storage (convert binary to base64)
    const messageContent = isBinary ? (message as Buffer).toString('base64') : message.toString();

    // Basic logging
    const logPreview = messageContent.substring(0, 150) + (messageContent.length > 150 ? '...' : '');
    const logType = isBinary ? 'Binary (base64)' : 'Text';
    console.log(`[Intercepted ${logType}] ${serviceName}: ${logPreview}`);

    // Create the new message object
    const newMessage: InterceptedMessage = {
      timestamp: Date.now(),
      message: messageContent,
      isBinary: isBinary,
    };

    // Add the new message
    currentMessages.push(newMessage);

    // Trim old messages if the store exceeds the limit
    if (currentMessages.length > MAX_MESSAGES_PER_SERVICE) {
      currentMessages.splice(0, currentMessages.length - MAX_MESSAGES_PER_SERVICE);
    }

    // Save the updated array back to storage
    await storage.setItem(storageKey, currentMessages);

    // --- Discord Bridging Logic ---
    if (!isBinary) {
        const messageText = message.toString();

        // 1. Get the bridge config for this service FIRST
        const bridgeConfig = await getBridgeServiceConfig(serviceName);

        // 2. Check if bridging is enabled AND a regex is configured
        if (bridgeConfig.enabled && bridgeConfig.regex) {
            console.log(`[Interceptor] Bridging enabled for ${serviceName} with regex: ${bridgeConfig.regex}`);
            try {
                // 3. Create the RegExp object from the configured string
                //    Append \s*$ to allow for potential trailing whitespace/newlines
                const dynamicRegex = new RegExp(bridgeConfig.regex.trim() + '\\s*$');
                console.log(`[Interceptor] Checking message with dynamic regex: "${messageText.trim()}"`);

                // 4. Attempt the match
                const match = messageText.trim().match(dynamicRegex);

                if (match) {
                     // Assuming regex captures username in group 1 and message in group 2
                     // This might need adjustment depending on user-defined regex patterns
                     const username = match[1] ?? 'UnknownUser'; // Default if group 1 is missing
                     const chatMessage = match[2] ?? 'No message'; // Default if group 2 is missing
                     console.log(`[Interceptor] Dynamic regex matched! User: ${username}, Msg: ${chatMessage.substring(0,50)}...`);

                     // 5. Check if webhook URL is also configured
                     if (bridgeConfig.webhookUrl) {
                         console.log(`[Interceptor -> Discord Bridge] Bridging message from ${username} for service ${serviceName}`);
                         // Don't wait for the Discord message to send
                         sendToDiscord(username, chatMessage, bridgeConfig.webhookUrl);
                     } else {
                         console.log(`[Interceptor -> Discord Bridge] Skipping send: Webhook URL not set for ${serviceName}`);
                     }
                } else {
                    console.log(`[Interceptor] Dynamic regex did not match.`);
                }
            } catch (regexError) {
                 console.error(`[Interceptor] Error creating or using regex for ${serviceName}: ${bridgeConfig.regex}`, regexError);
            }
        } else {
             // Log why bridging isn't active
            if (!bridgeConfig.enabled) console.log(`[Interceptor] Bridging disabled for ${serviceName}.`);
            if (bridgeConfig.enabled && !bridgeConfig.regex) console.log(`[Interceptor] Bridging enabled but no regex configured for ${serviceName}.`);
        }
    }
    // --- End Discord Bridging Logic ---

  } catch (error) {
      console.error(`[Interceptor] Error storing message for ${serviceName}:`, error);
  }
}

/**
 * Retrieves the intercepted messages for a specific service from Nitro storage.
 * @param serviceName The name of the service.
 * @returns A promise resolving to an array of intercepted messages, or an empty array if none or error.
 */
export async function getInterceptedMessages(serviceName: string): Promise<InterceptedMessage[]> {
  try {
    const storage = useStorage(STORAGE_BASE);
    const storageKey = getStorageKey(serviceName);
    const messages = (await storage.getItem<InterceptedMessage[]>(storageKey)) || [];
    return messages;
  } catch (error) {
      console.error(`[Interceptor] Error retrieving messages for ${serviceName}:`, error);
      return []; // Return empty array on error
  }
}

/**
 * Clears intercepted messages for a specific service from Nitro storage.
 * @param serviceName The name of the service.
 */
export async function clearInterceptedMessages(serviceName: string): Promise<void> {
   try {
        const storage = useStorage(STORAGE_BASE);
        const storageKey = getStorageKey(serviceName);
        await storage.removeItem(storageKey);
        console.log(`[Interceptor] Cleared stored messages for ${serviceName}`);
   } catch (error) {
       console.error(`[Interceptor] Error clearing messages for ${serviceName}:`, error);
   }
}

/**
 * Clears all intercepted messages from Nitro storage by iterating through known services.
 */
export async function clearAllInterceptedMessages(): Promise<void> {
    try {
        const storage = useStorage(STORAGE_BASE);
        // Get the list of currently known services
        const discoveredServices = (await storage.getItem<DiscoveredService[]>(STORAGE_KEY_DISCOVERED)) || [];
        let clearedCount = 0;

        console.log(`[Interceptor] Attempting to clear messages for ${discoveredServices.length} known services...`);

        for (const service of discoveredServices) {
            if (service?.name) {
                const storageKey = getStorageKey(service.name);
                // Check if item exists before removing (optional, removeItem is safe)
                // if (await storage.hasItem(storageKey)) {
                   await storage.removeItem(storageKey);
                   clearedCount++;
                // }
            }
        }
        console.log(`[Interceptor] Cleared stored messages for ${clearedCount} services.`);

    } catch (error) {
        console.error(`[Interceptor] Error clearing all intercepted messages:`, error);
    }
}