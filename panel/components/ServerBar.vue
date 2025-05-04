<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
// Removed unused DiscoveredService import

// Define the structure received from SSE
interface ServiceBaseInfo {
  name: string;
  cleanName?: string | null; // Add cleanName here
}

// Define the states for the server itself (fetched from API)
type ServerState = 'online' | 'inactive' | 'offline' | 'loading' | 'error';

// Local storage key
const LOCAL_STORAGE_KEY = 'minecraft-panel-services';

// Define services ref with the base info
const services = ref<ServiceBaseInfo[]>([]);
// Map to store the detailed server state for each service
const serverStateMap = ref<Record<string, ServerState>>({});
const isLoadingSSE = ref(true);
const sseError = ref<string | null>(null);
let eventSource: EventSource | null = null;
let statePollInterval: ReturnType<typeof setInterval> | null = null;

// State for the trigger button
const isTriggeringScan = ref(false);
const triggerError = ref<string | null>(null);
const triggerSuccessMessage = ref<string | null>(null);

// State for editing service names
const editingServiceName = ref<string | null>(null);
const editInputValue = ref<string>('');
const isSavingName = ref(false);
const saveError = ref<string | null>(null);

const connectSSE = () => {
  if (eventSource) { eventSource.close(); }
  isLoadingSSE.value = true;
  sseError.value = null;
  eventSource = new EventSource('/api/services/subscribe');

  eventSource.onopen = () => {
    console.log('SSE connection opened.');
    isLoadingSSE.value = false;
  };

  eventSource.onmessage = (event) => {
    try {
      const updatedServices = JSON.parse(event.data) as ServiceBaseInfo[];
      // Update local storage
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedServices));
      
      // Update reactive ref
      const previousServiceNames = new Set(services.value.map(s => s.name));
      services.value = updatedServices;

      // Check for new services and fetch their initial state
      for (const service of updatedServices) {
        if (!previousServiceNames.has(service.name)) {
          console.log(`New service detected via SSE: ${service.name}, fetching initial state.`);
          fetchServerState(service.name);
        }
        // Ensure existing services have a state entry if they don't (e.g., after error)
        if (!(service.name in serverStateMap.value)) {
           serverStateMap.value[service.name] = 'loading';
           fetchServerState(service.name); // Fetch state if missing
        }
      }

      // Clean up state map for removed services (optional, good practice)
      const currentServiceNames = new Set(updatedServices.map(s => s.name));
      for (const name in serverStateMap.value) {
        if (!currentServiceNames.has(name)) {
          delete serverStateMap.value[name];
        }
      }

      isLoadingSSE.value = false;
      sseError.value = null;
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
      sseError.value = 'Failed to process server update.';
      isLoadingSSE.value = false; // Show error, stop loading indicator
    }
  };

  eventSource.onerror = (err) => {
    sseError.value = 'Connection error. Attempting to reconnect...';
    isLoadingSSE.value = false;
    eventSource?.close();
    setTimeout(connectSSE, 5000);
  };
};

// Function to trigger the manual scan
const triggerScan = async () => {
  isTriggeringScan.value = true;
  triggerError.value = null;
  triggerSuccessMessage.value = null;
  try {
    // Use $fetch (Nuxt 3 composable for fetching)
    const response = await $fetch<any>('/api/discover/trigger', { // Add <any> type assertion for now
      method: 'POST'
    });
    console.log('Trigger scan response:', response);
    
    // Check if the expected fields exist from the updated trigger endpoint
    if (typeof response.servicesFoundThisScan === 'number' && typeof response.servicesAddedOrUpdated === 'number') {
       triggerSuccessMessage.value = `Scan done. Found ${response.servicesFoundThisScan}, added/updated ${response.servicesAddedOrUpdated}.`;
    } else {
       // Fallback message if the response structure is different (e.g., only status)
       triggerSuccessMessage.value = response.status || 'Discovery process restarted.';
    }

    // Clear success message after a delay
    setTimeout(() => triggerSuccessMessage.value = null, 3000);
  } catch (err: any) {
    console.error('Error triggering scan:', err);
    triggerError.value = err.data?.message || 'Failed to trigger scan.';
    // Clear error message after a delay
    setTimeout(() => triggerError.value = null, 5000);
  } finally {
    isTriggeringScan.value = false;
  }
};

// --- New Function to Fetch Server State --- 
const fetchServerState = async (serviceName: string) => {
  // Avoid fetching if already loading this specific service
  if (serverStateMap.value[serviceName] === 'loading' && !(services.value.find(s => s.name === serviceName))) return; // Avoid redundant fetches if starting up
  
  serverStateMap.value[serviceName] = 'loading'; // Set to loading immediately
  try {
    const state = await $fetch<ServerState>(`/api/server-state/${encodeURIComponent(serviceName)}`);
    serverStateMap.value[serviceName] = state; // Update with fetched state (online, inactive, offline)
  } catch (err) {
    console.error(`Error fetching state for ${serviceName}:`, err);
    serverStateMap.value[serviceName] = 'error'; // Set specific error state
  }
};

// --- New Function to Poll All Server States --- 
const pollAllServerStates = () => {
  console.log(`Polling states for ${services.value.length} services...`);
  services.value.forEach(service => {
    // Only poll if not currently in an error state or already loading
    if (serverStateMap.value[service.name] !== 'error' && serverStateMap.value[service.name] !== 'loading') {
        fetchServerState(service.name);
    } else if (!serverStateMap.value[service.name]) {
        // If state is missing entirely, fetch it
        fetchServerState(service.name);
    }
  });
};

onMounted(() => {
  // Load initial state from localStorage
  try {
    const storedServices = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedServices) {
      const parsedServices = JSON.parse(storedServices) as ServiceBaseInfo[];
      services.value = parsedServices;
      // If we load from storage, immediately start fetching state for them
      parsedServices.forEach(service => {
          if (!serverStateMap.value[service.name]) { // Avoid overwriting loading state if already started
              serverStateMap.value[service.name] = 'loading';
          }
          fetchServerState(service.name);
      });
      isLoadingSSE.value = false; 
    }
  } catch (e) {
    console.error('Failed to load or parse services from localStorage:', e);
    localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear invalid data
  }

  connectSSE();

  // Start polling server states - Moved to watcher
  // statePollInterval = setInterval(pollAllServerStates, 10000); // Poll every 10 seconds
});

onUnmounted(() => {
  if (eventSource) {
    console.log('Closing SSE connection.');
    eventSource.close();
    eventSource = null;
  }
  // Clear the polling interval
  if (statePollInterval) {
    clearInterval(statePollInterval);
    statePollInterval = null;
  }
});

// Watch the services list to start/stop polling
watch(services, (newServices, oldServices) => {
  const hadServices = oldServices && oldServices.length > 0;
  const hasServices = newServices.length > 0;

  if (hasServices && !statePollInterval) {
    // Start polling if we now have services and polling isn't active
    console.log('Services detected, starting state polling.');
    pollAllServerStates(); // Poll immediately upon getting services
    statePollInterval = setInterval(pollAllServerStates, 10000); 
  } else if (!hasServices && statePollInterval) {
    // Stop polling if we no longer have services and polling is active
    console.log('No services left, stopping state polling.');
    clearInterval(statePollInterval);
    statePollInterval = null;
  }
}, { deep: true }); // Use deep watch if needed, but length change should be sufficient

// Function to start editing a service name
const startEditing = (service: ServiceBaseInfo) => {
  editingServiceName.value = service.name;
  editInputValue.value = service.cleanName || '';
};

// Function to handle keydown events in the edit input
const handleEditKeyDown = (event: KeyboardEvent, serviceName: string) => {
  if (event.key === 'Enter') {
    saveCleanName(serviceName);
  } else if (event.key === 'Escape') {
    cancelEditing();
  }
};

// Function to save the edited service name
const saveCleanName = async (serviceName: string) => {
  if (!editingServiceName.value || isSavingName.value) return;
 
  // Treat empty input as cancellation
  if (editInputValue.value.trim() === '') {
      cancelEditing();
      return;
  }

  const newCleanName = editInputValue.value.trim();
  isSavingName.value = true;
  saveError.value = null;
  try {
    // --- Restore API Call --- 
    await $fetch('/api/services/set-clean-name', {
      method: 'POST',
      body: { serviceName: serviceName, cleanName: newCleanName },
    });
    // Optimistic UI update (the SSE will eventually confirm or correct)
    const serviceRef = services.value.find(s => s.name === serviceName);
    if (serviceRef) {
      serviceRef.cleanName = newCleanName || null;
    }
    cancelEditing(); // Exit edit mode on success
    // ------------------------- 
  } catch (err: any) {
    console.error('Error saving clean name:', err);
    saveError.value = err.data?.message || 'Failed to save name.';
    // Don't cancel editing on error, let user retry or cancel
  } finally {
    isSavingName.value = false;
  }
};

// Function to cancel editing a service name
const cancelEditing = () => {
  editingServiceName.value = null;
  editInputValue.value = '';
  saveError.value = null;
};

</script>

<template>
<div class="h-screen py-6 px-6 w-min min-w-64 bg-neutral-900 flex flex-col">
    <div class="flex items-center gap-4 mb-4">
        <Icon name="mdi:server" class="text-neutral-400" />
        <span class="text-white text-sm font-medium whitespace-nowrap">Server List</span>
    </div>

    <!-- Trigger Scan Button -->
    <div class="mb-4">
        <button 
            @click="triggerScan"
            :disabled="isTriggeringScan"
            class="w-full px-3 py-1.5 text-xs font-medium text-center text-white bg-blue-600 rounded hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
            <span v-if="isTriggeringScan">Scanning...</span>
            <span v-else>Scan Network</span>
        </button>
        <div v-if="triggerError" class="mt-1 text-xs text-red-500">{{ triggerError }}</div>
        <div v-if="triggerSuccessMessage" class="mt-1 text-xs text-green-500">{{ triggerSuccessMessage }}</div>
    </div>

    <!-- Discovered Services Section -->
    <div class="flex-1 overflow-y-auto flex flex-col gap-2">
        <div v-if="isLoadingSSE && services.length === 0" class="text-neutral-500 text-xs">Connecting to service updates...</div>
        <!-- Display SSE Error independently -->
        <div v-if="sseError" class="text-red-500 text-xs mb-2">{{ sseError }}</div> 
        
        <!-- Show "No services" only if truly empty and not loading/erroring -->
        <div v-if="!isLoadingSSE && services.length === 0 && !sseError" class="text-neutral-500 text-xs">No active services found. Scan network?</div>
        
        <!-- Render the list if services exist (loaded from storage or SSE) -->
        <template v-if="services.length > 0">
            <div
                v-for="service in services"
                :key="service.name"
                class="relative text-neutral-300 text-xs border border-neutral-700 p-2 rounded hover:bg-neutral-800 transition-colors group"
            >
                <NuxtLink
                    :to="`/server/${encodeURIComponent(service.name)}`"
                    class="absolute inset-0 z-0 rounded"
                    aria-label="Go to server console"
                 />
                 <div class="relative z-10 flex justify-between items-center">
                     <!-- Left side: Name display or Edit Input -->
                     <div class="flex-1 min-w-0 pr-2">
                         <div v-if="editingServiceName !== service.name" class="flex items-center space-x-1.5">
                             <!-- Name Block -->
                             <NuxtLink :to="`/server/${encodeURIComponent(service.name)}`" class="flex-1 min-w-0 group/link">
                                <div class="truncate">
                                    <span v-if="service.cleanName" class="font-semibold group-hover/link:underline">{{ service.cleanName }}</span>
                                    <span v-else class="font-medium text-neutral-500 italic group-hover/link:underline">unnamed</span>
                                </div>
                                <div class="text-neutral-500 text-[10px] truncate group-hover/link:underline">{{ service.name }}</div>
                             </NuxtLink>
                             <!-- Edit Button -->
                             <button @click.stop="startEditing(service)" class="p-0.5 rounded text-neutral-500 hover:text-white hover:bg-neutral-700 flex-shrink-0 z-10">
                                <Icon name="mdi:pencil" size="13" />
                             </button>
                         </div>
                         <div v-else class="flex items-center space-x-1">
                             <input
                                :id="`edit-input-${service.name}`"
                                v-model="editInputValue"
                                type="text"
                                placeholder="untitled"
                                class="flex-grow px-1 py-0.5 text-xs bg-neutral-600 border border-neutral-500 text-neutral-100 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                @keydown="handleEditKeyDown($event, service.name)"
                                @blur="saveCleanName(service.name)"
                                @click.stop
                             />
                             <button @click.stop="saveCleanName(service.name)" :disabled="isSavingName" class="p-0.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-600 disabled:opacity-50">
                                 <Icon name="mdi:check" size="14" />
                             </button>
                             <button @click.stop="cancelEditing" class="p-0.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-600">
                                 <Icon name="mdi:close" size="14" />
                             </button>
                         </div>
                         <!-- Show save error below input -->
                         <div v-if="editingServiceName === service.name && saveError" class="mt-1 text-xs text-red-500">{{ saveError }}</div>
                     </div>
                     <!-- Right side: Status Indicator -->
                     <span
                         class="w-2 h-2 rounded-full flex-shrink-0"
                         :class="{ 
                             'bg-green-500': serverStateMap[service.name] === 'online', 
                             'bg-yellow-500': serverStateMap[service.name] === 'inactive', 
                             'bg-red-500': serverStateMap[service.name] === 'offline', 
                             'bg-purple-500': serverStateMap[service.name] === 'error', 
                             'bg-neutral-600 animate-pulse': serverStateMap[service.name] === 'loading', 
                             'bg-neutral-700': !serverStateMap[service.name] // Default/unknown 
                         }"
                         :title="`State: ${serverStateMap[service.name] || 'Unknown'}`"
                     ></span>
                 </div>
             </div>
        </template>
    </div>
</div>
</template>
