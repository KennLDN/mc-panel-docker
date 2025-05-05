import { Client, Events, GatewayIntentBits } from 'discord.js'
import { useRuntimeConfig, setDiscordStatus, getDiscordStatus } from '#imports'

export default defineNitroPlugin(async (nitroApp) => {
  // console.log('Initializing Nitro Discord plugin...') // Removed

  const config = useRuntimeConfig()
  const token = config.discordToken

  if (!token) {
    // console.error('DISCORD_TOKEN environment variable not provided.') // Removed
    await setDiscordStatus({ status: 'error', message: 'DISCORD_TOKEN not configured.' })
    return
  }

  // Create a new client instance
  // Intents determine which events your bot receives.
  // For sending messages, Guilds is often necessary.
  // Add more intents based on required events.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  // Attach the client to the Nitro app instance for potential use elsewhere
  // @ts-ignore: Augmenting nitroApp type dynamically
  nitroApp.discordClient = client

  client.once(Events.ClientReady, async (readyClient) => {
    // console.log(`Discord client ready! Logged in as ${readyClient.user.tag}`) // Removed
    await setDiscordStatus({ status: 'up', message: `Logged in as ${readyClient.user.tag}` })
  })

  client.on(Events.Error, async (error) => {
    // console.error('Discord client error:', error) // Removed
    await setDiscordStatus({ status: 'error', message: `Discord client error: ${error.message}` })
    // Depending on the error, you might want to attempt reconnection or shutdown
  })

  try {
    // console.log('Logging into Discord...') // Removed
    const currentStatus = await getDiscordStatus()
    if (currentStatus.status !== 'up') { // Avoid duplicate connection attempts if already connecting/up
      await setDiscordStatus({ status: 'initializing', message: 'Connecting to Discord...' })
      await client.login(token)
    }
  } catch (error) {
    // console.error('Failed to login to Discord:', error) // Removed
    const errorMessage = error instanceof Error ? error.message : 'Unknown login error'
    await setDiscordStatus({ status: 'error', message: `Discord login failed: ${errorMessage}` })
  }
}) 