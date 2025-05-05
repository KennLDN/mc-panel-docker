import { defineEventHandler, H3Event } from 'h3'
import { getDiscordStatus } from '#imports' // Auto-imported from server/utils/discordState

// Define the expected return type based on the interface in discordState.ts
interface DiscordStatus {
  status: 'initializing' | 'up' | 'down' | 'error'
  message?: string
}

export default defineEventHandler(async (event: H3Event): Promise<DiscordStatus> => {
  const status = await getDiscordStatus()
  return status
}) 