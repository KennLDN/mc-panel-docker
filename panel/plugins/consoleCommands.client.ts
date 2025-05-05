import { useServiceRegistry } from '~/composables/useServiceRegistry';
import { $fetch } from 'ofetch'; // Import $fetch directly

// Define a more specific type for the result objects for clarity
type ServiceDeleteResult = 
  | { name: string; status: 'fulfilled'; response: any } 
  | { name: string; status: 'rejected'; error: any };

export default defineNuxtPlugin((nuxtApp) => {
  // --- clearServices Function ---
  const clearServices = async () => {
    console.log('[Console Command] Attempting to clear all registered services...');
    const { services } = useServiceRegistry();
    const serviceNames = services.value.map(s => s.name);

    if (serviceNames.length === 0) {
      console.log('[Console Command] No services currently registered.');
      return;
    }

    console.log(`[Console Command] Found ${serviceNames.length} services to delete:`, serviceNames);

    const results = await Promise.allSettled(
      serviceNames.map(name =>
        // Return a Promise that resolves to our specific ServiceDeleteResult type
        $fetch(`/api/services/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          ignoreResponseError: true, // Handle errors manually
        }).then(response => ({ name, status: 'fulfilled', response } as ServiceDeleteResult))
          .catch(error => ({ name, status: 'rejected', error } as ServiceDeleteResult))
      )
    );

    let successCount = 0;
    let failCount = 0;

    // Iterate through the results, now correctly typed
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        // Access the resolved value, which is our ServiceDeleteResult
        const data = result.value;
        if (data.status === 'fulfilled') { // Double-check the status we set
          console.log(`[Console Command] Successfully requested deletion for ${data.name}`);
          successCount++;
        }
        // Note: It's technically possible result.status is 'fulfilled' but data.status is 'rejected'
        // if the catch block above somehow didn't re-throw, but that shouldn't happen here.
      } else {
        // Access the rejection reason, which *should* be our ServiceDeleteResult due to the catch
        const reason = result.reason as ServiceDeleteResult; 
        if (reason && reason.status === 'rejected') {
            console.error(`[Console Command] Failed to delete ${reason.name}:`, reason.error?.data?.message || reason.error);
        } else {
             // Fallback for unexpected rejection structure
            console.error('[Console Command] Failed to delete a service with unexpected error structure:', result.reason);
        }
        failCount++;
      }
    });

    console.log(`[Console Command] Deletion process finished. Success: ${successCount}, Failed: ${failCount}. The list should update shortly via SSE.`);
  };

  // --- forceSearch Function ---
  const forceSearch = async () => {
    console.log('[Console Command] Forcing network scan via /api/discover/trigger...');
    try {
      const response = await $fetch<any>('/api/discover/trigger', {
        method: 'POST',
      });
      console.log('[Console Command] Force search trigger successful:', response);
    } catch (error: any) {
      console.error('[Console Command] Failed to trigger force search:', error.data?.message || error);
    }
  };

  // --- Attach to Window ---
  if (process.client) {
    (window as any).clearServices = clearServices;
    (window as any).forceSearch = forceSearch;
  }
}); 