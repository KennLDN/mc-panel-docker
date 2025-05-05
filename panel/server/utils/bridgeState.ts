import { useStorage } from '#imports'

export interface BridgeServiceConfig {
  enabled: boolean
  regex: string | null
  format: string | null
  serverId: string | null
  messageId: string | null
  webhookUrl: string | null
}

// Type for the listener callback
export type BridgeChangeListener = (serviceName: string, config: BridgeServiceConfig | null) => void;

// Simple in-memory store for listeners
const listeners = new Map<string, BridgeChangeListener>();

// Function to notify all listeners
function notifyListeners(serviceName: string, config: BridgeServiceConfig | null): void {
  console.log(`[BridgeState] Notifying listeners about change in ${serviceName}`);
  listeners.forEach(listener => listener(serviceName, config));
}

// Function for modules to subscribe to changes
export function subscribeBridgeChanges(id: string, listener: BridgeChangeListener): void {
  listeners.set(id, listener);
  console.log(`[BridgeState] Listener registered: ${id}`);
}

// Function for modules to unsubscribe
export function unsubscribeBridgeChanges(id: string): void {
  listeners.delete(id);
  console.log(`[BridgeState] Listener deregistered: ${id}`);
}

const storage = useStorage('minecraft_services')

const defaultConfig: BridgeServiceConfig = {
  enabled: false,
  regex: null,
  format: null,
  serverId: null,
  messageId: null,
  webhookUrl: null,
}

export async function getBridgeServiceConfig(
  serviceName: string,
): Promise<BridgeServiceConfig> {
  const config = await storage.getItem<BridgeServiceConfig>(serviceName)
  // Return default config merged with stored config if it exists
  return { ...defaultConfig, ...(config ?? {}) }
}

export async function setBridgeServiceConfig(
  serviceName: string,
  newConfig: Partial<BridgeServiceConfig>,
): Promise<void> {
  const currentConfig = await getBridgeServiceConfig(serviceName)
  const mergedConfig = { ...currentConfig, ...newConfig }
  await storage.setItem(serviceName, mergedConfig)
  // Notify listeners about the change
  notifyListeners(serviceName, mergedConfig);
}

// Optional: Add a function to handle explicit deletion if needed
// export async function deleteBridgeServiceConfig(serviceName: string): Promise<void> {
//   await storage.removeItem(serviceName);
//   notifyListeners(serviceName, null); // Notify listeners of deletion
// } 