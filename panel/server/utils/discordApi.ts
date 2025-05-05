import {
  Client,
  Guild,
  ChannelType,
  TextChannel,
  PermissionsBitField,
  Collection
} from 'discord.js'

// Define the structure for the output
export interface GuildChannelInfo {
  id: string
  name: string
  channels: {
    id: string
    name: string
  }[]
}

export interface AccessibleGuilds {
  [guildId: string]: GuildChannelInfo
}

/**
 * Fetches guilds and their text channels where the bot has read/send permissions.
 * @param client The authenticated discord.js Client instance.
 * @returns An object mapping guild IDs to guild and channel info.
 */
export function getAccessibleGuildsAndChannels(client: Client): AccessibleGuilds {
  const results: AccessibleGuilds = {}

  if (!client.isReady()) {
    console.warn('Attempted to get guilds/channels, but Discord client is not ready.')
    // Optionally throw an error or return a specific state
    return results // Return empty if not ready
  }

  client.guilds.cache.forEach((guild: Guild) => {
    const accessibleChannels: GuildChannelInfo['channels'] = []

    // Get the bot's member object in this guild to check permissions
    const me = guild.members.me
    if (!me) {
      console.warn(`Could not find bot member in guild ${guild.name} (${guild.id}). Skipping.`)
      return // Skip guild if bot member info isn't available
    }

    guild.channels.cache.forEach((channel) => {
      // Check if it's a text-based channel (TextChannel, NewsChannel, Thread, etc.)
      if (channel.isTextBased()) {
          // Check permissions
          const perms = channel.permissionsFor(me)
          if (perms?.has(PermissionsBitField.Flags.ViewChannel) && perms?.has(PermissionsBitField.Flags.SendMessages)) {
            accessibleChannels.push({
              id: channel.id,
              name: channel.name,
            })
          }
      }
    })

    // Only add the guild if it has accessible channels
    if (accessibleChannels.length > 0) {
      results[guild.id] = {
        id: guild.id,
        name: guild.name,
        channels: accessibleChannels,
      }
    }
  })

  return results
} 