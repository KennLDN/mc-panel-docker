import { defineEventHandler, createError } from 'h3'
import { useNitroApp } from '#imports'
import { getAccessibleGuildsAndChannels, AccessibleGuilds } from '~/server/utils/discordApi'
import type { Client } from 'discord.js'

// Augment the NitroApp interface if using TypeScript for the added property
declare module 'nitropack' {
  interface NitroApp {
    discordClient?: Client
  }
}

export default defineEventHandler(async (/* event */): Promise<AccessibleGuilds> => {
  // Get the Nitro app instance using the composable
  const nitroApp = useNitroApp()
  // Access the client attached by the plugin
  const client = nitroApp.discordClient

  // Check if client exists (was attached by the plugin)
  if (!client) {
    console.error('[API /discord-guilds] Discord client not found on nitroApp instance.')
    throw createError({
      statusCode: 503,
      statusMessage: 'Discord client is not initialized on the server.',
    })
  }

  // Check if client is ready
  if (!client.isReady()) {
     console.warn('[API /discord-guilds] Discord client is not ready.')
     throw createError({
        statusCode: 503,
        statusMessage: 'Discord client is currently not ready. Try again shortly.'
     })
  }

  try {
    const guilds = getAccessibleGuildsAndChannels(client)
    return guilds
  } catch (error) {
    console.error('[API /discord-guilds] Error getting accessible guilds:', error)
    throw createError({
        statusCode: 500,
        statusMessage: 'Failed to retrieve Discord server information.'
    })
  }
}) 