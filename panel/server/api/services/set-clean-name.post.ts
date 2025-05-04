import { defineEventHandler, readBody } from 'h3';
import { useStorage } from 'nitropack/runtime';

interface CleanNamePayload {
  serviceName: string;
  cleanName: string;
}

// Define the type for the storage object
type CleanNameMap = Record<string, string>;

export default defineEventHandler(async (event) => {
  const storage = useStorage('minecraft_services');
  const payload = await readBody<CleanNamePayload>(event);

  if (!payload || typeof payload.serviceName !== 'string' || typeof payload.cleanName !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid payload. Required fields: serviceName (string), cleanName (string)',
    });
  }

  const { serviceName, cleanName } = payload;

  // Get the current map or initialize an empty one
  const cleanNames = await storage.getItem<CleanNameMap>('clean_names') || {};

  // Update or add the clean name
  if (cleanName.trim() === '') {
    // If cleanName is empty, remove the mapping
    delete cleanNames[serviceName];
    console.log(`Removed clean name for service: ${serviceName}`);
  } else {
    cleanNames[serviceName] = cleanName.trim();
    console.log(`Set clean name for service ${serviceName} to: ${cleanName.trim()}`);
  }

  // Store the updated map
  await storage.setItem('clean_names', cleanNames);

  return { success: true, serviceName, cleanName: cleanNames[serviceName] || null };
}); 