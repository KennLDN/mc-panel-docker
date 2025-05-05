import { ref } from 'vue';
import { useState } from '#imports';

// Define the structure matching ServerBar
interface ServiceBaseInfo {
  name: string;
  cleanName?: string | null;
}

// Define the server state type matching ServerBar
type ServerState = 'online' | 'inactive' | 'offline' | 'loading' | 'error';

export const useServiceRegistry = () => {
  // Shared state for the list of discovered services
  const services = useState<ServiceBaseInfo[]>('registered-services', () => []);

  // Shared state for the status of each service (used by ServerBar)
  const serverStateMap = useState<Record<string, ServerState>>('server-state-map', () => ({}));

  return {
    services,
    serverStateMap,
  };
}; 