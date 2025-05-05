import { defineEventHandler } from 'h3'
import { getBridgeServiceConfig } from '~/server/utils/bridgeState'

export default defineEventHandler(async (event) => {
  const serviceName = event.context.params?.serviceName

  if (!serviceName) {
    // Set response status code and return an error
    event.node.res.statusCode = 400
    return { error: 'Service name is required in the URL path.' }
  }

  try {
    // Call the utility function to get the config
    const config = await getBridgeServiceConfig(serviceName)

    // Return the config
    event.node.res.statusCode = 200
    return config

  } catch (error: any) {
    console.error(`Error fetching config for service ${serviceName}:`, error)
    // Set response status code and return an error
    event.node.res.statusCode = 500
    return { error: 'Internal Server Error', message: error.message }
  }
}) 