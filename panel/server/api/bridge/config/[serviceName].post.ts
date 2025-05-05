import { defineEventHandler, readBody } from 'h3'
import { setBridgeServiceConfig } from '~/server/utils/bridgeState'

// Define the expected structure of the request body (subset of BridgeServiceConfig)
interface UpdateConfigBody {
  enabled?: boolean
  regex?: string | null
  format?: string | null
  serverId?: string | null
  messageId?: string | null
  webhookUrl?: string | null
}

export default defineEventHandler(async (event) => {
  const serviceName = event.context.params?.serviceName

  if (!serviceName) {
    // Set response status code and return an error
    event.node.res.statusCode = 400
    return { error: 'Service name is required in the URL path.' }
  }

  try {
    // Read the body which should contain the partial config
    const body = await readBody<UpdateConfigBody>(event)

    // Basic validation: Ensure body is an object
    if (typeof body !== 'object' || body === null) {
      event.node.res.statusCode = 400
      return { error: 'Invalid request body. Expected an object.' }
    }

    // Call the utility function to set/update the config
    await setBridgeServiceConfig(serviceName, body)

    // Optionally, return the updated config or just a success status
    // For now, just return success
    event.node.res.statusCode = 200
    return { success: true, serviceName: serviceName }

  } catch (error: any) {
    console.error(`Error updating config for service ${serviceName}:`, error)
    // Set response status code and return an error
    event.node.res.statusCode = 500
    return { error: 'Internal Server Error', message: error.message }
  }
}) 