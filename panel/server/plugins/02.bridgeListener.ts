import { defineNitroPlugin, useStorage } from '#imports';
import { type Client, Events, type Message } from 'discord.js';
import {
    getBridgeServiceConfig,
    type BridgeServiceConfig,
    subscribeBridgeChanges,
    unsubscribeBridgeChanges,
} from '~/server/utils/bridgeState';
import { sendProxiedRconCommand } from '~/server/utils/rconUtils';
import { convertTextAndColorFormat } from '~/server/utils/formatConverter';

// Store active bridge configurations being monitored
const activeBridges = new Map<string, BridgeServiceConfig>();
const LISTENER_ID = 'bridgeListenerPlugin'; // Unique ID for the listener

// Function to update the active bridges map based on config changes
function handleBridgeConfigChange(serviceName: string, config: BridgeServiceConfig | null): void {
    if (config?.enabled) {
        if (!activeBridges.has(serviceName) || JSON.stringify(activeBridges.get(serviceName)) !== JSON.stringify(config)) {
            activeBridges.set(serviceName, config);
            console.log(`[BridgeListener] Enabled/updated monitoring for service: ${serviceName}`, config);
        }
    } else {
        if (activeBridges.has(serviceName)) {
            activeBridges.delete(serviceName);
            console.log(`[BridgeListener] Disabled/Removed monitoring for service: ${serviceName}`);
        }
    }
    console.log(`[BridgeListener] Active bridges: ${Array.from(activeBridges.keys()).join(', ') || 'None'}`);
}

export default defineNitroPlugin(async (nitroApp) => {
  console.log('[BridgeListener] Initializing plugin...');
  // @ts-ignore: Accessing augmented nitroApp type
  const client: Client | undefined = nitroApp.discordClient;

  if (!client) {
    console.error('[BridgeListener] Discord client not found on nitroApp. Ensure discord plugin runs first.');
    return;
  }
  console.log('[BridgeListener] Discord client found.');

  // Wait for the client to be ready
  if (!client.isReady()) {
    console.log('[BridgeListener] Discord client not ready, waiting for ClientReady event...');
    await new Promise<void>(resolve => client.once(Events.ClientReady, () => resolve()));
  }
  console.log('[BridgeListener] Discord client is ready. Initializing bridge listeners...');

  // --- Initial population of active bridges ---
  console.log('[BridgeListener] Performing initial config load...');
  const storage = useStorage('minecraft_services');
  const keys = await storage.getKeys();
  for (const key of keys) {
      // Assuming key IS the service name (e.g., 'survival')
      const serviceName = key;
      try {
          const config = await getBridgeServiceConfig(serviceName);
          // Use the handler to potentially add it to activeBridges if enabled
          handleBridgeConfigChange(serviceName, config);
      } catch (error) {
          console.error(`[BridgeListener] Error loading initial config for key ${key}:`, error);
      }
  }
  console.log('[BridgeListener] Initial config load complete.');

  // --- Subscribe to future changes --- 
  subscribeBridgeChanges(LISTENER_ID, handleBridgeConfigChange);
  console.log('[BridgeListener] Subscribed to bridge config changes.');

  // --- Setup listener cleanup on app close --- 
  nitroApp.hooks.hookOnce('close', () => {
      console.log('[BridgeListener] Nitro app closing, unsubscribing from bridge changes...');
      unsubscribeBridgeChanges(LISTENER_ID);
  });

  // Listen for messages
  client.on(Events.MessageCreate, async (message: Message) => {
    console.log(`[BridgeListener] Message received: "${message.content}" from ${message.author.tag} in channel ${message.channelId}, guild ${message.guildId}`);

    if (message.author.bot || !message.guildId || !message.channelId) {
      console.log('[BridgeListener] Ignoring message (bot or no guild/channel).');
      return;
    }

    console.log(`[BridgeListener] Checking ${activeBridges.size} active bridge(s)...`);

    // Check against active bridges
    for (const [serviceName, config] of activeBridges.entries()) {
      console.log(`[BridgeListener] Checking service: ${serviceName}`);
      // Assuming config.messageId is the Channel ID and config.serverId is the Guild ID
      if (config.enabled && config.serverId === message.guildId && config.messageId === message.channelId) {
        console.log(`[BridgeListener] Match found for service ${serviceName}. Guild: ${message.guildId}, Channel: ${message.channelId}`);
        if (!config.format) {
           console.warn(`[BridgeListener] Service ${serviceName} is enabled but has no format string defined. Skipping.`);
           continue; // Skip if format is not defined
        }
        console.log(`[BridgeListener] Using format for ${serviceName}: ${config.format}`);

        // Placeholder replacement
        const username = message.member?.displayName ?? message.author.username;
        const messageContent = message.content;
        let finalJsonPayload: string;

        try {
            // 1. Parse the format string using the converter
            const formatObjects = convertTextAndColorFormat(config.format);

            // 2. Replace placeholders within the 'text' properties
            const processedObjects = formatObjects.map(obj => ({
                ...obj,
                text: obj.text
                    .replace(/\[username\]/g, username)
                    .replace(/\[message\]/g, messageContent)
            }));

            // 3. Re-stringify the processed objects back into JSON
            finalJsonPayload = JSON.stringify(processedObjects);
            console.log(`[BridgeListener] Processed format payload: ${finalJsonPayload}`);

        } catch (e) {
            console.error(`[BridgeListener] Error processing format string for service ${serviceName}. Format: "${config.format}", Error: ${e instanceof Error ? e.message : String(e)}`);
            continue; // Skip sending if format is invalid or processing fails
        }

        // Construct and send RCON command
        const rconCommand = `tellraw @a ${finalJsonPayload}`;
        console.log(`[BridgeListener] Sending to ${serviceName}: ${rconCommand}`);

        try {
          const response = await sendProxiedRconCommand(serviceName, rconCommand);
          console.log(`[BridgeListener] RCON response from ${serviceName}: ${response}`);
        } catch (error) {
          console.error(`[BridgeListener] Failed to send RCON command to ${serviceName}:`, error instanceof Error ? error.message : String(error));
          // Handle specific errors (e.g., service not found, timeout) if necessary
        }
      } else {
        // Optional: Log why a specific active bridge didn't match
        // console.log(`[BridgeListener] No match for service ${serviceName}. Enabled: ${config.enabled}, Config Server: ${config.serverId}, Msg Server: ${message.guildId}, Config Channel: ${config.messageId}, Msg Channel: ${message.channelId}`);
      }
    }
  });

  console.log('[BridgeListener] Nitro plugin initialized and message listener attached.');
}); 