<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useServiceRegistry } from '~/composables/useServiceRegistry'; // Import the composable

// Define the structure received from SSE (can eventually be shared)
interface ServiceBaseInfo {
  name: string;
  cleanName?: string | null;
}

// Define the states for the server itself (can eventually be shared)
type ServerState = 'online' | 'inactive' | 'offline' | 'loading' | 'error';

// Local storage key (Consider if still needed or managed by composable)
const LOCAL_STORAGE_KEY = 'minecraft-panel-services';

// Use the composable for shared state
const { services, serverStateMap } = useServiceRegistry();

// State for the show hidden checkbox
const showHidden = ref(false);

// Map to store the state *before* a service entered 'loading'
const previousServerStateBeforeLoading = ref<Record<string, ServerState>>({});

// Computed property to filter out offline or certain loading servers
const visibleServices = computed(() => {
  // If showHidden is checked, display ALL services regardless of state
  if (showHidden.value) {
    return services.value; // Return the full list
  }

  // Otherwise, apply the original filtering logic
  return services.value.filter(service => {
    const currentState = serverStateMap.value[service.name];

    // Rule 1: Always hide if offline
    if (currentState === 'offline') {
        return false;
    }

    // Rule 2: If loading, only show if it was previously online
    if (currentState === 'loading') {
        const previousState = previousServerStateBeforeLoading.value[service.name];
        // ONLY show if loading explicitly after being online
        if (previousState === 'online') {
            return true; // Keep it visible
        } else {
            // Hide if loading initially, or after offline/inactive/error
            return false;
        }
    }

    // Rule 3: Hide if state is unknown (shouldn't happen often with polling but good safeguard)
    if (!currentState) {
        return false;
    }

    // Otherwise (online, inactive, error, or loading after online), show it
    return true;
  });
});

// Remove local refs that are now managed by the composable
// const services = ref<ServiceBaseInfo[]>([]);
// const serverStateMap = ref<Record<string, ServerState>>({});

const isLoadingSSE = ref(true);
const sseError = ref<string | null>(null);
let eventSource: EventSource | null = null;
let statePollInterval: ReturnType<typeof setInterval> | null = null;
// ... existing state ...

const connectSSE = () => {
  if (eventSource) { eventSource.close(); }
  isLoadingSSE.value = true;
  sseError.value = null;
  eventSource = new EventSource('/api/services/subscribe');

  eventSource.onopen = () => {
    isLoadingSSE.value = false;
  };

  eventSource.onmessage = (event) => {
    try {
      const updatedServices = JSON.parse(event.data) as ServiceBaseInfo[];
      // Update local storage (Keep for now, maybe remove later)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedServices));
      
      // Update reactive ref FROM COMPOSABLE
      const previousServiceNames = new Set(services.value.map(s => s.name));
      services.value = updatedServices; // <-- Update the composable's state

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

      // Clean up state map for removed services (using composable's state)
      const currentServiceNames = new Set(updatedServices.map(s => s.name));
      for (const name in serverStateMap.value) {
        if (!currentServiceNames.has(name)) {
          delete serverStateMap.value[name]; // <-- Update the composable's state
          delete previousServerStateBeforeLoading.value[name]; // <-- Clean up previous state too
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
  // if (serverStateMap.value[serviceName] === 'loading' && !(services.value.find(s => s.name === serviceName))) return; // Avoid redundant fetches if starting up
  
  // Only set to loading if the state is unknown or error, not if it's already a known state
  const currentState = serverStateMap.value[serviceName];
  if (!currentState || currentState === 'error' || currentState === 'loading') {
    // --> Store previous state ONLY if transitioning TO loading
    if (currentState !== 'loading') {
        previousServerStateBeforeLoading.value[serviceName] = currentState ?? 'offline'; // Store current state before loading (treat undefined as offline initially)
    }
    serverStateMap.value[serviceName] = 'loading'; // Set to loading immediately only if needed
  }
  
  try {
    // Use $fetch with explicit type if possible
    const state = await $fetch<ServerState>(`/api/server-state/${encodeURIComponent(serviceName)}`);
    serverStateMap.value[serviceName] = state; // Update with fetched state (online, inactive, offline)
    delete previousServerStateBeforeLoading.value[serviceName]; // <-- Clear previous state on success
  } catch (err) {
    console.error(`Error fetching state for ${serviceName}:`, err);
    serverStateMap.value[serviceName] = 'error'; // Set specific error state
    delete previousServerStateBeforeLoading.value[serviceName]; // <-- Clear previous state on error
  }
};

// --- New Function to Poll All Server States --- 
const pollAllServerStates = () => {
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
  // Load initial state from localStorage (Keep for now)
  try {
    const storedServices = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedServices) {
      const parsedServices = JSON.parse(storedServices) as ServiceBaseInfo[];
      services.value = parsedServices; // Initialize composable state from storage
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

  // Start polling server states - logic remains the same but uses composable state
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  // Clear the polling interval
  if (statePollInterval) {
    clearInterval(statePollInterval);
    statePollInterval = null;
  }
});

// Watch the services list (from composable) to start/stop polling
watch(services, (newServices, oldServices) => {
  const hadServices = oldServices && oldServices.length > 0;
  const hasServices = newServices.length > 0;

  if (hasServices && !statePollInterval) {
    // Start polling if we now have services and polling isn't active
    pollAllServerStates(); // Poll immediately upon getting services
    statePollInterval = setInterval(pollAllServerStates, 10000); 
  } else if (!hasServices && statePollInterval) {
    // Stop polling if we no longer have services and polling is active
    console.log('No services left, stopping state polling.');
    clearInterval(statePollInterval);
    statePollInterval = null;
  }
}, { deep: true }); // Use deep watch if needed, but length change should be sufficient

// State for the trigger button
const isTriggeringScan = ref(false);
const triggerError = ref<string | null>(null);
const triggerSuccessMessage = ref<string | null>(null);

// State for editing service names
const editingServiceName = ref<string | null>(null);
const editInputValue = ref<string>('');
const isSavingName = ref(false);
const saveError = ref<string | null>(null);

// --- State for Deleting Services --- (New)
const deletingServiceName = ref<string | null>(null);
const deleteError = ref<string | null>(null);

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

// --- Function to Confirm and Delete Service --- (New)
const confirmAndDeleteService = (serviceName: string) => {
  if (deletingServiceName.value === serviceName) return; // Already deleting

  const confirmationMessage = "This server will be removed from the list! If it comes back online it will automatically be readded.";
  if (window.confirm(confirmationMessage)) {
    deleteService(serviceName);
  }
};

// --- Function to Delete Service via API --- (New)
const deleteService = async (serviceName: string) => {
  deletingServiceName.value = serviceName;
  deleteError.value = null;
  try {
    await $fetch(`/api/services/${encodeURIComponent(serviceName)}`, {
      method: 'DELETE',
    });
    // No client-side removal needed, SSE will update the list.
    // Optionally show a temporary success message or indication.
  } catch (err: any) {
    console.error(`Error deleting service ${serviceName}:`, err);
    deleteError.value = err.data?.statusMessage || `Failed to delete ${serviceName}.`;
    // Clear error after a delay
    setTimeout(() => deleteError.value = null, 5000);
  } finally {
    deletingServiceName.value = null;
  }
};

</script>

<template>
<div class="h-screen py-6 px-6 w-min min-w-64 bg-neutral-900 flex flex-col">
    <div class="flex items-center gap-4 mb-4">
        <Icon name="mdi:server" class="text-neutral-400" />
        <span class="text-white text-sm font-medium whitespace-nowrap">Server List</span>
    </div>

    <!-- Trigger Scan Button -->
    <div class="mb-2">
        <div v-if="triggerError" class="mt-1 text-xs text-red-500">{{ triggerError }}</div>
        <div v-if="triggerSuccessMessage" class="mt-1 text-xs text-green-500">{{ triggerSuccessMessage }}</div>
    </div>

    <!-- Delete Error Display (New) -->
    <div v-if="deleteError" class="my-1 text-xs text-red-500 border border-red-700/50 bg-red-900/20 p-1.5 rounded">{{ deleteError }}</div>

    <!-- Discovered Services Section -->
    <div class="flex-1 overflow-y-auto flex flex-col gap-3 mb-4">
        <div v-if="isLoadingSSE && services.length === 0" class="text-neutral-500 text-xs">Connecting to service updates...</div>
        <!-- Display SSE Error independently -->
        <!-- <div v-if="sseError" class="text-red-500 text-xs mb-2">{{ sseError }}</div>  -->
        
        <!-- Show "No services" only if truly empty and not loading/erroring, considering the filter -->
        <div v-if="!isLoadingSSE && visibleServices.length === 0 && !sseError" class="text-neutral-500 text-xs">
            <span v-if="services.length > 0">All services are currently offline.</span>
            <span v-else>No active services found. Scan network?</span>
        </div>
        
        <!-- Render the list if VISIBLE services exist -->
        <template v-if="visibleServices.length > 0">
            <div
                v-for="service in visibleServices"
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
                             <button @click.stop="startEditing(service)" class="p-0.5 rounded text-neutral-500 mt-1 hover:text-white hover:bg-neutral-700 flex-shrink-0 z-10">
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
                             <button @click.stop="saveCleanName(service.name)" :disabled="isSavingName" class="p-0.5 rounded text-neutral-400 mt-1 hover:text-white hover:bg-neutral-600 disabled:opacity-50">
                                 <Icon name="mdi:check" size="14" />
                             </button>
                             <button @click.stop="cancelEditing" class="p-0.5 rounded text-neutral-400 mt-1 hover:text-white hover:bg-neutral-600">
                                 <Icon name="mdi:close" size="14" />
                             </button>
                         </div>
                         <!-- Show save error below input -->
                         <div v-if="editingServiceName === service.name && saveError" class="mt-1 text-xs text-red-500">{{ saveError }}</div>
                     </div>
                     <!-- Right side: Status Indicator and Delete Button -->
                     <div class="flex items-center flex-shrink-0 space-x-1.5">
                       <span
                           class="w-2 h-2 rounded-full flex-shrink-0"
                           :class="{ 
                               'bg-green-500': serverStateMap[service.name] === 'online', 
                               'bg-orange-500': serverStateMap[service.name] === 'inactive',
                               'bg-red-500': serverStateMap[service.name] === 'offline', 
                               'bg-purple-500': serverStateMap[service.name] === 'error', 
                               'bg-neutral-600 animate-pulse': serverStateMap[service.name] === 'loading', 
                               'bg-neutral-700': !serverStateMap[service.name] // Default/unknown 
                           }"
                           :title="`State: ${serverStateMap[service.name] || 'Unknown'}`"
                       ></span>
                       <!-- Delete Button (New) -->
                       <button
                         v-if="serverStateMap[service.name] === 'offline'"
                         @click.stop="confirmAndDeleteService(service.name)"
                         :disabled="deletingServiceName === service.name"
                         class="p-0.5 mt-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-wait flex-shrink-0 z-10"
                         title="Remove offline server from list"
                       >
                         <Icon v-if="deletingServiceName !== service.name" name="mdi:close" size="13" />
                         <svg v-else class="animate-spin h-3 w-3 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                       </button>
                     </div>
                 </div>
             </div>
        </template>
    </div>
    <!-- Show Hidden Checkbox -->
    <div class="pt-4 border-t border-neutral-700/50">
        <label class="flex items-center space-x-2 text-xs text-neutral-400 cursor-pointer hover:text-neutral-200 transition-colors">
            <input
                type="checkbox"
                v-model="showHidden"
                class="form-checkbox h-3.5 w-3.5 rounded text-blue-500 bg-neutral-700 border-neutral-600 focus:ring-blue-500/50 focus:ring-offset-neutral-900 cursor-pointer"
            />
            <span>Show Hidden</span>
        </label>
    </div>
</div>
</template>
