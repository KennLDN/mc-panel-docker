import { defineEventHandler, getRouterParam, createError } from 'h3';
import { getServiceFlags } from '~/server/utils/flagsUtils';
import type { ServiceFlags } from '~/server/utils/flagsUtils';

export default defineEventHandler(async (event): Promise<ServiceFlags> => {
  const name = getRouterParam(event, 'name');

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service name is required',
    });
  }

  try {
    const flags = await getServiceFlags(name);
    return flags;
  } catch (error: any) {
    console.error(`[API Flags GET] Error retrieving flags for '${name}':`, error);
    throw createError({
        statusCode: 500,
        statusMessage: 'Failed to retrieve service flags.',
    });
  }
}); 