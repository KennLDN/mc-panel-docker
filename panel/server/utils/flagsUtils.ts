import { useStorage } from '#imports';

// Define the structure for service flags
export interface ServiceFlags {
  sparktps: boolean;
  // Add other flags here in the future
}

const STORAGE_BASE = 'minecraft_services';
const FLAGS_KEY = 'service_flags';
const DEFAULT_FLAGS: ServiceFlags = { sparktps: false };

/**
 * Retrieves the flags for a specific service.
 * @param name The name of the service.
 * @returns The flags for the service, defaulting to { sparktps: false }.
 */
export async function getServiceFlags(name: string): Promise<ServiceFlags> {
  if (!name) {
    // Consider throwing an error or returning default/null depending on desired strictness
    console.warn('[getServiceFlags] Service name is required.');
    return { ...DEFAULT_FLAGS }; // Return a copy
  }
  const storage = useStorage(STORAGE_BASE);
  const allFlags = (await storage.getItem<Record<string, ServiceFlags>>(FLAGS_KEY)) || {};
  return allFlags[name] ?? { ...DEFAULT_FLAGS }; // Return a copy
}

/**
 * Updates a specific flag for a given service.
 * @param name The name of the service.
 * @param flagName The key of the flag to update (e.g., 'sparktps').
 * @param value The new boolean value for the flag.
 * @returns The updated flags object for the service.
 * @throws If there's an error updating storage.
 */
export async function setServiceFlag<K extends keyof ServiceFlags>(
    name: string,
    flagName: K,
    value: ServiceFlags[K]
): Promise<ServiceFlags> {

  if (!name) {
    throw new Error('[setServiceFlag] Service name is required.');
  }
  if (typeof value !== 'boolean') { // Basic type check for current flags
      throw new Error(`[setServiceFlag] Invalid value type for flag '${flagName}'. Expected boolean.`);
  }

  const storage = useStorage(STORAGE_BASE);
  try {
    const allFlags = (await storage.getItem<Record<string, ServiceFlags>>(FLAGS_KEY)) || {};
    const currentServiceFlags = allFlags[name] ?? { ...DEFAULT_FLAGS };

    currentServiceFlags[flagName] = value;
    allFlags[name] = currentServiceFlags;

    await storage.setItem(FLAGS_KEY, allFlags);
    console.log(`[FlagsUtils] Updated flag '${flagName}' for '${name}' to ${value}.`);
    return currentServiceFlags;

  } catch (error: any) {
    console.error(`[FlagsUtils] Error setting flag '${flagName}' for '${name}':`, error);
    throw new Error(`Failed to update service flag '${flagName}'.`); // Re-throw for handling by caller
  }
} 