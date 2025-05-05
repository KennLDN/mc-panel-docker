import { defineEventHandler, createError, H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'

const BASE_URL = 'https://discord.com/api/oauth2/authorize'
const SCOPE = 'bot'
// Permissions: SendMessages (2048 = 0x800), ViewChannel (1024 = 0x400)
const PERMISSIONS = '3072' // 2048 | 1024

export default defineEventHandler((event: H3Event) => {
  const config = useRuntimeConfig()
  const clientId = config.discordClientId

  if (!clientId) {
    console.error('DISCORD_CLIENT_ID is not configured in runtimeConfig.')
    throw createError({
      statusCode: 500,
      statusMessage: 'Server configuration error: Discord Client ID not set.'
    })
  }

  const inviteUrl = `${BASE_URL}?client_id=${clientId}&permissions=${PERMISSIONS}&scope=${SCOPE}`

  return {
    inviteUrl
  }
}) 