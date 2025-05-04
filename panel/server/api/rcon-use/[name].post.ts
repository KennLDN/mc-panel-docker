import { defineEventHandler, getRouterParam, createError, readBody } from 'h3';
import { sendProxiedRconCommand } from '~/server/utils/rconUtils'; // Import the utility function

// Interface for the expected request body
interface RconRequestBody {
  command: string;
}

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name');

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name is required',
    });
  }

  // Read and validate the command from the request body
  let commandToSend: string;
  try {
    const body = await readBody<RconRequestBody>(event);
    if (!body || typeof body.command !== 'string' || body.command.trim() === '') {
        throw new Error('Invalid or missing command in request body.');
    }
    commandToSend = body.command.trim();
  } catch (e: any) {
     throw createError({
      statusCode: 400,
      statusMessage: `Failed to parse request body or invalid command: ${e.message}`,
    });
  }

  // Call the utility function to send the command
  try {
    const rconResponse = await sendProxiedRconCommand(name, commandToSend);

    // Return the successful response
    return { response: rconResponse };

  } catch (error: any) {
    // Log the error from the utility
    console.error(`[API RCON POST] Error processing RCON command for '${name}':`, error.message || error);

    // Create an H3 error based on the error thrown by the utility
    // Use the statusCode attached in the utility function, default to 500 if missing
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.message || 'An unexpected error occurred while processing the RCON command.',
      // Optionally include original error data if needed for debugging, but be cautious about exposing details
      // data: { originalError: error.originalError?.message } 
    });
  }
}); 