<script setup lang="ts">
    import { ref, watch, computed } from 'vue'
    import { useRoute } from 'vue-router' // Import useRoute
    import type { AccessibleGuilds, GuildChannelInfo } from '~/server/utils/discordApi' // Import types
    import type { BridgeServiceConfig } from '~/server/utils/bridgeState' // Import bridge config type

    // Define the status interface (matching backend)
    interface DiscordStatus {
      status: 'initializing' | 'up' | 'down' | 'error'
      message?: string
    }

    // Props definition using defineProps
    const props = defineProps<{
      modelValue: boolean // Controls visibility (v-model)
    }>()

    // Emits definition using defineEmits
    const emit = defineEmits<{
      (e: 'update:modelValue', value: boolean): void // For v-model
    }>()

    // --- Route Info ---
    const route = useRoute()
    const currentServerId = computed(() => route.params.name as string) // Use name instead of id

    // --- Modal State ---
    const currentView = ref<'main' | 'bridge'>('main') // 'main' or 'bridge'

    const closeModal = () => {
      emit('update:modelValue', false)
      // Reset view when closing
      setTimeout(() => { // Delay slightly to allow fade-out
          currentView.value = 'main'
      }, 300)
    }

    // Close modal when clicking the backdrop
    const backdropClick = (event: MouseEvent) => {
      if (event.target === event.currentTarget) {
        closeModal()
      }
    }

    // View switching functions
    const showBridgeConfig = async () => {
        currentView.value = 'bridge'
        // Only fetch bridge config if bot is up and we have the server ID
        if (isBotUp.value && currentServerId.value) {
            await fetchBridgeConfig(currentServerId.value)
        } else if (!isBotUp.value) {
            // Clear any previous bridge config errors if bot isn't up
            bridgeConfigError.value = null
        }
    }
    const showMainConfig = () => {
        currentView.value = 'main'
    }

    // --- Discord Status Logic ---
    const discordStatus = ref<DiscordStatus | null>(null)
    const isLoadingStatus = ref(false)
    const statusError = ref<string | null>(null)

    // --- Guilds & Channels Logic ---
    const accessibleGuilds = ref<AccessibleGuilds | null>(null)
    const isLoadingGuilds = ref(false)
    const guildsError = ref<string | null>(null)
    const selectedGuildId = ref<string>('')
    const selectedChannelId = ref<string>('')

    // --- Bridge Config Logic --- (New)
    const bridgeConfig = ref<BridgeServiceConfig | null>(null)
    const isLoadingBridgeConfig = ref(false)
    const bridgeConfigError = ref<string | null>(null)
    const isBridgeEnabled = ref(false) // Store enabled state separately for reactivity
    const isSavingBridgeConfig = ref(false) // Loading state for save/disable
    const bridgeSaveError = ref<string | null>(null)

    // Fetch Guilds data
    const fetchGuilds = async () => {
      isLoadingGuilds.value = true
      guildsError.value = null
      accessibleGuilds.value = null // Clear previous
      // Don't reset selectedGuildId/ChannelId here, let fetchBridgeConfig handle it
      try {
        const guilds = await $fetch<AccessibleGuilds>('/api/discord-guilds')
        accessibleGuilds.value = guilds
      } catch (err: any) {
        console.error('Failed to fetch Discord guilds:', err)
        guildsError.value = err.data?.statusMessage || 'Failed to load server list.'
      } finally {
        isLoadingGuilds.value = false
      }
    }

    // Fetch Discord Status (and potentially guilds)
    const fetchDiscordStatus = async () => {
      if (!props.modelValue) return // Don't fetch if modal is not visible
      isLoadingStatus.value = true
      statusError.value = null
      discordStatus.value = null // Clear previous status
      // Reset guild state as well
      accessibleGuilds.value = null
      guildsError.value = null
      selectedGuildId.value = ''
      selectedChannelId.value = ''
      // Reset bridge state too
      bridgeConfig.value = null
      isLoadingBridgeConfig.value = false
      bridgeConfigError.value = null
      isBridgeEnabled.value = false

      try {
        const status = await $fetch<DiscordStatus>('/api/discord-status')
        discordStatus.value = status
        // If status is UP, fetch guilds
        if (status.status === 'up') {
          await fetchGuilds() // Chain the fetch
          // If we are already targeting the bridge view, fetch its config now
          if (currentView.value === 'bridge' && currentServerId.value) {
            await fetchBridgeConfig(currentServerId.value)
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch Discord status:', err)
        statusError.value = err.data?.message || 'Failed to load bot status.'
        discordStatus.value = { status: 'error', message: statusError.value } // Set a default error state
      } finally {
        isLoadingStatus.value = false
      }
    }

    // Fetch Bridge Configuration (New)
    const fetchBridgeConfig = async (serviceName: string) => {
        isLoadingBridgeConfig.value = true
        bridgeConfigError.value = null
        bridgeConfig.value = null
        // Reset fields before fetching, keeping existing values if fetch fails
        const previousGuildId = selectedGuildId.value
        const previousChannelId = selectedChannelId.value
        const previousRegex = messageRegex.value
        const previousFormat = messageFormat.value
        const previousEnabled = isBridgeEnabled.value
        const previousWebhookUrl = webhookUrlInput.value // <-- Store previous webhook URL

        selectedGuildId.value = ''
        selectedChannelId.value = ''
        messageRegex.value = '^\\[\\d{2}:\\d{2}:\\d{2}\\] \\[.*?\\]: <(.*?)> (.*)' // Reset to default
        messageFormat.value = '[["[d] ", "#aa00ff"], ["<[username]> [message]", "#ffffff"]]' // Reset to default
        isBridgeEnabled.value = false
        webhookUrlInput.value = null // <-- Reset webhook URL input

        try {
            const config = await $fetch<BridgeServiceConfig>(`/api/bridge/config/${serviceName}`)
            bridgeConfig.value = config
            isBridgeEnabled.value = config.enabled

            // Populate fields ONLY if values exist in the fetched config
            selectedGuildId.value = config.serverId || ''
            // Populate other fields
            messageRegex.value = config.regex ?? '^\[\d{2}:\d{2}:\d{2}\] \[.*?\]: <(.*?)> (.*)'
            messageFormat.value = config.format ?? '[["[d] ", "#aa00ff"], ["<[username]> [message]", "#ffffff"]]'
            webhookUrlInput.value = config.webhookUrl ?? null

        } catch (err: any) {
            console.error(`Failed to fetch bridge config for ${serviceName}:`, err)
            bridgeConfigError.value = err.data?.message || 'Failed to load bridge configuration.'
            // Restore previous values on error
            selectedGuildId.value = previousGuildId
            selectedChannelId.value = previousChannelId
            messageRegex.value = previousRegex
            messageFormat.value = previousFormat
            isBridgeEnabled.value = previousEnabled
            webhookUrlInput.value = previousWebhookUrl // <-- Restore previous webhook URL on error
        } finally {
            isLoadingBridgeConfig.value = false
        }
    }

    // Save Bridge Configuration (New)
    const saveBridgeConfig = async (enable: boolean) => {
        if (!currentServerId.value) {
            bridgeSaveError.value = "Could not determine the service ID."
            return
        }
        if (!enable && !isBridgeEnabled.value) {
            // Already disabled, nothing to do
            return
        }
         if (enable && (!selectedGuildId.value || !selectedChannelId.value)) {
             bridgeSaveError.value = "Please select a server and channel before enabling.";
             return;
         }

        isSavingBridgeConfig.value = true
        bridgeSaveError.value = null

        const configToSave: Partial<BridgeServiceConfig> = {
            enabled: enable,
            serverId: selectedGuildId.value || null, // Save null if empty string
            messageId: selectedChannelId.value || null, // Save null if empty string
            regex: messageRegex.value || null, // Save null if empty string
            format: messageFormat.value || null, // Save null if empty string
            webhookUrl: webhookUrlInput.value || null // <-- Include webhook URL in save data
        }

        try {
            await $fetch(`/api/bridge/config/${currentServerId.value}`, {
                method: 'POST',
                body: configToSave,
            })
            // Update local state on success
            isBridgeEnabled.value = enable
            bridgeConfig.value = { // Update local cache (or refetch)
                ...bridgeConfig.value, // Keep existing non-updated values if any
                ...configToSave,
                // Ensure non-optional fields have defaults if not set
                enabled: configToSave.enabled ?? false,
                regex: configToSave.regex ?? null,
                format: configToSave.format ?? null,
                serverId: configToSave.serverId ?? null,
                messageId: configToSave.messageId ?? null,
                webhookUrl: configToSave.webhookUrl ?? null // <-- Update local cache with webhook URL
            }
             // Optionally close modal or show success message
             // closeModal() // Example: Close modal on successful save
        } catch (err: any) {
            console.error('Failed to save bridge config:', err)
            bridgeSaveError.value = err.data?.message || 'Failed to save bridge configuration.'
        } finally {
            isSavingBridgeConfig.value = false
        }
    }


    // Watch for the modal becoming visible to fetch the status (and guilds)
    watch(() => props.modelValue, (newValue) => {
      if (newValue) {
        fetchDiscordStatus() // This might trigger fetchBridgeConfig if conditions are met
      }
    })

    // Computed property to check if the bot is considered 'up'
    const isBotUp = computed(() => discordStatus.value?.status === 'up')

    // Computed property for the list of available channels based on selected server
    const availableChannels = computed(() => {
      if (!selectedGuildId.value || !accessibleGuilds.value) {
        return []
      }
      return accessibleGuilds.value[selectedGuildId.value]?.channels ?? []
    })

    // Watch for available channels changing (after server selection or guild fetch)
    // This is needed to set the channel ID after the list is available
    watch(availableChannels, (newChannels) => {
        console.log('[Watcher availableChannels] Running. New channel count:', newChannels.length);
        // Only proceed if we are not currently loading the config and have a fetched config with a messageId
        if (!isLoadingBridgeConfig.value && bridgeConfig.value?.messageId) {
            const targetChannelId = bridgeConfig.value.messageId;
            console.log(`[Watcher availableChannels] Checking for targetChannelId: ${targetChannelId}`);
            // Check if the previously selected/fetched channel ID exists in the new list
            const channelExists = newChannels.some(channel => channel.id === targetChannelId);

            if (channelExists) {
                console.log(`[Watcher availableChannels] Target channel ${targetChannelId} found. Setting selectedChannelId.`);
                selectedChannelId.value = targetChannelId; // Set the v-model value
                console.log(`[Watcher availableChannels] selectedChannelId value immediately after setting: '${selectedChannelId.value}'`);
            } else {
                 console.log(`[Watcher availableChannels] Target channel ${targetChannelId} not found in the current list. Clearing selectedChannelId.`);
                 // If the stored channel ID is no longer valid for this server, clear the selection
                 // Avoid clearing if the user might be in the process of selecting a different *server*
                 if(selectedGuildId.value === bridgeConfig.value.serverId) { // Only clear if the server matches the config
                    selectedChannelId.value = ''
                 }
                 // Optionally clear the stored config value too (might be too aggressive)
                 // if (bridgeConfig.value) bridgeConfig.value.messageId = null
            }
        } else {
           console.log('[Watcher availableChannels] Skipping logic: isLoadingBridgeConfig=', isLoadingBridgeConfig.value, 'bridgeConfig.value?.messageId=', bridgeConfig.value?.messageId);
        }
        // If there's no stored config or channelId, do nothing, let user select
    }, { immediate: false }) // Don't run immediately, wait for channels list

    // Watch for server selection change to reset channel selection manually if needed
    // (The availableChannels watcher handles setting from fetched config)
    watch(selectedGuildId, (newGuildId, oldGuildId) => {
        console.log(`[Watcher selectedGuildId] Running. Old: '${oldGuildId}', New: '${newGuildId}', isLoadingBridgeConfig: ${isLoadingBridgeConfig.value}`);
        // Only reset if changing FROM a valid selection and not loading
        if (oldGuildId && oldGuildId !== newGuildId && !isLoadingBridgeConfig.value) {
            console.log('[Watcher selectedGuildId] Resetting selectedChannelId due to manual server change from a previous selection.');
            selectedChannelId.value = ''
        } else {
            console.log('[Watcher selectedGuildId] Conditions not met for reset.');
        }
    })

    // Default values for bridge inputs (now potentially overridden by fetch)
    const messageRegex = ref('^\\[\\d{2}:\\d{2}:\\d{2}\\] \\[.*?\\]: <(.*?)> (.*)') // Corrected escaping
    const messageFormat = ref('[["[d] ", "#aa00ff"], ["<[username]> [message]", "#ffffff"]]') // <-- Added space
    const webhookUrlInput = ref<string | null>(null) // <-- Add ref for webhook URL input

    // Computed property to determine the placeholder text for the server dropdown
    const serverPlaceholderText = computed(() => {
        if (isLoadingGuilds.value) return 'Loading servers...' // Added loading state
        if (guildsError.value) return 'Error loading servers' // Added error state
        if (accessibleGuilds.value && Object.keys(accessibleGuilds.value).length === 0) {
            return 'Please invite the bot to a server'
        }
        return '-- Select a Server --'
    })

    // --- Invite URL Logic ---
    const isLoadingInviteUrl = ref(false)
    const inviteError = ref<string | null>(null)

    const fetchAndOpenInviteUrl = async () => {
      isLoadingInviteUrl.value = true
      inviteError.value = null
      try {
        const response = await $fetch<{ inviteUrl: string }>('/api/discord-invite-url')
        if (response.inviteUrl) {
          window.open(response.inviteUrl, '_blank', 'noopener,noreferrer')
        } else {
          throw new Error('Invite URL not found in response.')
        }
      } catch (err: any) {
        console.error('Failed to fetch or open invite URL:', err)
        inviteError.value = err.data?.statusMessage || err.message || 'Failed to get invite URL.'
      } finally {
        isLoadingInviteUrl.value = false
      }
    }
    </script>

    <template>
      <transition name="modal-fade">
        <div
          v-if="modelValue"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          @click.self="backdropClick"
        >
          <div class="bg-neutral-800 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 text-neutral-200 relative overflow-hidden">
            <!-- Close Button -->
            <button
              @click="closeModal"
              class="absolute top-6 right-6 text-neutral-500 hover:text-neutral-300 transition-colors z-10"
              aria-label="Close modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <!-- Back Button (only in bridge view) -->
            <button
                v-if="currentView === 'bridge'"
                @click="showMainConfig"
                class="absolute top-6 left-6 text-neutral-500 hover:text-neutral-300 transition-colors z-10 p-1 rounded-full hover:bg-neutral-700"
                aria-label="Go back"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>

            <!-- Title -->
            <h3 class="text-xl font-semibold border-b border-neutral-700 pb-4 text-center">
              {{ currentView === 'main' ? 'Configure Discord Bot' : 'Configure Discord Bridge' }}
            </h3>

            <!-- Modal Content -->
            <div class="mt-4 space-y-5 max-h-[70vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800/50">
              <!-- Status Loading Indicator -->
              <div v-if="isLoadingStatus" class="flex items-center justify-center text-neutral-400 py-4">
                  <svg class="animate-spin mr-3 h-5 w-5 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Loading bot status...
              </div>

              <!-- Status Error Message -->
              <div v-else-if="statusError && !isLoadingStatus" class="text-center text-red-400 bg-red-900/20 p-3 rounded border border-red-700/50">
                <p class="font-medium">Error loading status:</p>
                <p class="text-sm">{{ statusError }}</p>
              </div>

              <!-- Content based on Status -->
              <div v-else-if="discordStatus && !isLoadingStatus">

                  <!-- ######################## -->
                  <!-- ##### Main View ###### -->
                  <!-- ######################## -->
                  <div v-if="currentView === 'main'" class="space-y-4">
                      <!-- Section for when Bot is UP -->
                      <template v-if="isBotUp">
                          <!-- Discord Bridge Button -->
                          <button
                            @click="showBridgeConfig"
                            :disabled="!currentServerId"
                            class="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-blue-500 transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Configure Discord Bridge
                          </button>

                          <!-- Invite Button -->
                          <button
                            @click="fetchAndOpenInviteUrl"
                            :disabled="isLoadingInviteUrl"
                            class="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-neutral-700 hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                          >
                             <svg v-if="isLoadingInviteUrl" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            {{ isLoadingInviteUrl ? 'Fetching...' : 'Invite Bot to Server' }}
                          </button>
                          <!-- Invite Error Message -->
                          <p v-if="inviteError" class="text-sm text-red-400 text-center">
                            {{ inviteError }}
                          </p>
                      </template>

                      <!-- Section for when Bot is NOT UP -->
                      <template v-else>
                          <div class="text-center text-yellow-300 bg-yellow-900/30 p-3 rounded border border-yellow-700/50">
                              <p class="font-medium">Discord Bot is not running</p>
                              <p v-if="discordStatus.message" class="text-sm text-yellow-400 mt-1">{{ discordStatus.message }}</p>
                              <p class="text-xs text-neutral-400 mt-2">(Please ensure the bot process is started)</p>
                          </div>
                      </template>
                  </div>

                  <!-- ######################### -->
                  <!-- ##### Bridge View ##### -->
                  <!-- ######################### -->
                  <div v-if="currentView === 'bridge'">
                       <!-- Check if bot is up before showing bridge config -->
                       <template v-if="isBotUp">
                           <!-- Bridge Config Loading -->
                           <div v-if="isLoadingBridgeConfig || isLoadingGuilds" class="flex items-center justify-center text-neutral-400 py-4">
                                <svg class="animate-spin mr-3 h-5 w-5 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                               Loading bridge configuration...
                           </div>
                           <!-- Bridge Config Error -->
                           <div v-else-if="(bridgeConfigError || guildsError) && !isLoadingBridgeConfig && !isLoadingGuilds" class="text-center text-red-400 bg-red-900/20 p-3 rounded border border-red-700/50">
                              <p class="font-medium">Error loading configuration:</p>
                              <p v-if="guildsError" class="text-sm">{{ guildsError }}</p>
                              <p v-if="bridgeConfigError" class="text-sm">{{ bridgeConfigError }}</p>
                           </div>
                           <!-- Bridge Config Content -->
                           <div v-else-if="accessibleGuilds" class="space-y-3">
                                <!-- Server Select Dropdown -->
                                <div v-if="Object.keys(accessibleGuilds).length > 0">
                                   <p class="text-xs text-neutral-400 mb-1">Select message channel</p>
                                   <select
                                     id="discord-server"
                                     v-model="selectedGuildId"
                                     :disabled="isLoadingBridgeConfig || isSavingBridgeConfig"
                                     class="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-neutral-700 border border-neutral-600 text-neutral-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md appearance-none scrollbar-thin scrollbar-thumb-neutral-500 scrollbar-track-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                   >
                                     <option value="" disabled>
                                       {{ serverPlaceholderText }}
                                     </option>
                                     <option v-for="guild in accessibleGuilds" :key="guild.id" :value="guild.id">
                                       {{ guild.name }}
                                     </option>
                                   </select>
                               </div>
                               <!-- Message if no servers available -->
                                <div v-else class="text-center text-neutral-500 italic py-4">
                                    Bot is not in any servers or has no accessible channels. Please invite the bot.
                                </div>

                               <!-- Channel Select Dropdown (only if servers available) -->
                               <div v-if="Object.keys(accessibleGuilds).length > 0">
                                   <select
                                     id="discord-channel"
                                     v-model="selectedChannelId"
                                     :disabled="!selectedGuildId || availableChannels.length === 0 || isLoadingBridgeConfig || isSavingBridgeConfig"
                                     class="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-neutral-700 border border-neutral-600 text-neutral-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md appearance-none disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-neutral-700/50 scrollbar-thin scrollbar-thumb-neutral-500 scrollbar-track-neutral-700"
                                   >
                                     <option value="" disabled>-- Select a Channel --</option>
                                     <option v-for="channel in availableChannels" :key="channel.id" :value="channel.id">
                                       #{{ channel.name }} ({{ channel.type }})
                                     </option>
                                     <option v-if="selectedGuildId && availableChannels.length === 0" value="" disabled>No accessible text channels found</option>
                                   </select>
                               </div>

                               <!-- Input Fields (only if servers available) -->
                               <div v-if="Object.keys(accessibleGuilds).length > 0" class="mt-8 space-y-3">
                                     <div>
                                         <p class="text-xs text-neutral-400 mb-1">Message Regex (Optional)</p>
                                         <input
                                             type="text"
                                             v-model="messageRegex"
                                             :disabled="isLoadingBridgeConfig || isSavingBridgeConfig"
                                             placeholder="e.g., ^<(\w+)> (.*)"
                                             class="block w-full pl-3 pr-3 py-2 text-base bg-neutral-700 border border-neutral-600 text-neutral-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md placeholder-neutral-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                         />
                                     </div>
                                     <div>
                                         <p class="text-xs text-neutral-400 mb-1">Message Format (Optional)</p>
                                         <input
                                             type="text"
                                             v-model="messageFormat"
                                             :disabled="isLoadingBridgeConfig || isSavingBridgeConfig"
                                             placeholder='e.g., [["[d] ", "#aa00ff"], ["<[username]> [message]", "#ffffff"]]'
                                             class="block w-full pl-3 pr-3 py-2 text-base bg-neutral-700 border border-neutral-600 text-neutral-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md placeholder-neutral-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                         />
                                         <p class="text-xs text-neutral-400 mt-3">JSON format. Use [username], [message]. Capture groups from regex are [1], [2]...</p>
                                     </div>

                                     <!-- Webhook URL Input -->
                                     <div>
                                         <p class="text-xs text-neutral-400 mb-1">Webhook URL</p>
                                         <input
                                             type="text"
                                             v-model="webhookUrlInput"
                                             :disabled="isLoadingBridgeConfig || isSavingBridgeConfig"
                                             placeholder="https://discord.com/api/webhooks/..."
                                             class="block w-full pl-3 pr-3 py-2 text-base bg-neutral-700 border border-neutral-600 text-neutral-200 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md placeholder-neutral-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                         />
                                     </div>
                               </div>

                               <!-- Save/Enable/Disable Button Area (only if servers available) -->
                               <div v-if="Object.keys(accessibleGuilds).length > 0" class="mt-5">
                                   <!-- Enable Button -->
                                   <button
                                       v-if="!isBridgeEnabled"
                                       @click="saveBridgeConfig(true)"
                                       :disabled="!selectedGuildId || !selectedChannelId || isSavingBridgeConfig"
                                       class="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                                   >
                                       <svg v-if="isSavingBridgeConfig" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                       </svg>
                                       {{ isSavingBridgeConfig ? 'Enabling...' : 'Enable Discord Bridge' }}
                                   </button>

                                   <!-- Disable Button -->
                                   <button
                                       v-else
                                       @click="saveBridgeConfig(false)"
                                       :disabled="isSavingBridgeConfig"
                                       class="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-800 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                                   >
                                       <svg v-if="isSavingBridgeConfig" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                           <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                           <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                       </svg>
                                       {{ isSavingBridgeConfig ? 'Disabling...' : 'Disable Discord Bridge' }}
                                   </button>

                                   <!-- Save Error Message -->
                                   <p v-if="bridgeSaveError" class="text-sm text-red-400 text-center mt-2">
                                     {{ bridgeSaveError }}
                                   </p>
                               </div>
                           </div>

                       </template>
                        <!-- Message if trying to access bridge view but bot is down -->
                       <template v-else>
                            <p class="text-center text-yellow-400 bg-yellow-900/30 p-3 rounded border border-yellow-700/50">
                                Bot must be running to configure the bridge.
                            </p>
                       </template>
                  </div>
              </div>

            </div> <!-- End Scrollable Content -->
          </div>
        </div>
      </transition>
    </template>

    <style scoped>
    select {
      background-image: url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20"%3E%3Cpath stroke="%239ca3af" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 8l4 4 4-4"/%3E%3C/svg%3E');
      background-position: right 0.5rem center;
      background-repeat: no-repeat;
      background-size: 1.5em 1.5em;
      padding-right: 2.5rem;
    }
    select:disabled {
       background-image: url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20"%3E%3Cpath stroke="%236b7280" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 8l4 4 4-4"/%3E%3C/svg%3E'); /* Dimmer arrow */
    }
    /* Custom scrollbar styles for modal content */
    .scrollbar-thin::-webkit-scrollbar {
      width: 6px;
    }
    .scrollbar-thin::-webkit-scrollbar-track {
      background: rgba(38, 38, 38, 0.5); /* neutral-800 with alpha */
      border-radius: 10px;
    }
    .scrollbar-thin::-webkit-scrollbar-thumb {
      background-color: #525252; /* neutral-600 */
      border-radius: 10px;
      border: 1px solid rgba(38, 38, 38, 0.5); /* neutral-800 with alpha */
    }
    .scrollbar-thin::-webkit-scrollbar-thumb:hover {
      background-color: #737373; /* neutral-500 */
    }
    .scrollbar-thin {
      scrollbar-width: thin;
      scrollbar-color: #525252 rgba(38, 38, 38, 0.5); /* neutral-600 neutral-800/50 */
    }
    /* Fade transition */
    .modal-fade-enter-active,
    .modal-fade-leave-active {
      transition: opacity 0.3s ease;
    }

    .modal-fade-enter-from,
    .modal-fade-leave-to {
      opacity: 0;
    }
    </style> 