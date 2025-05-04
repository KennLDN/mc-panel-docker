import { defineEventHandler, createError } from 'h3';
import { Bonjour, Service, Browser } from 'bonjour-service';
// Import the control functions from the mdns plugin
import { startMdnsDiscovery, stopMdnsDiscovery } from '../../plugins/mdns';
// Import utilities needed for the temporary scan
import { processMdnsService, updateStoredServices } from '../../utils/mdnsUtils';
import type { DiscoveredService } from '../../utils/mdnsUtils';

const TEMP_SCAN_DURATION_MS = 3000; // Shorter duration for the explicit scan

export default defineEventHandler(async (event) => {
  console.log('Trigger received: Restarting background mDNS discovery and performing temporary scan...');

  // --- 1. Restart Background Listener --- 
  try {
    stopMdnsDiscovery();
    // No need to wait for startMdnsDiscovery to finish before doing the temporary scan
    startMdnsDiscovery(); 
    console.log('Background mDNS discovery restarted.');
  } catch (error: any) {
    // Log the error but proceed with the temporary scan if possible
    console.error('[Trigger API] Error restarting background mDNS discovery:', error);
    // Optionally return an error here if restarting the background task is critical
  }

  // --- 2. Perform Temporary Scan --- 
  const tempBonjour = new Bonjour();
  const foundDuringScan: DiscoveredService[] = [];
  let tempBrowser: Browser | null = null;
  let temporaryScanError: Error | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      try {
        tempBrowser = tempBonjour.find({ type: 'minecraft-control' }, (service: Service) => {
          const serviceInfo = processMdnsService(service);
          if (serviceInfo && !foundDuringScan.some(s => s.name === serviceInfo.name)) {
            console.log('[Temporary Scan] Found processed service:', serviceInfo);
            foundDuringScan.push(serviceInfo);
          }
        });

        tempBrowser.on('error', (err: Error) => {
          console.error('[Temporary Scan] Browser Error:', err);
          temporaryScanError = err; // Store error but don't reject the promise immediately
        });

        setTimeout(() => {
          console.log('[Temporary Scan] Scan duration elapsed.');
          resolve(); // Resolve even if there were browser errors during the scan
        }, TEMP_SCAN_DURATION_MS);

      } catch (initError) {
        // Catch errors during bonjour.find itself
        reject(initError);
      }
    });
  } catch (error) {
      console.error('[Temporary Scan] Failed to initialize or run scan:', error);
      // If the scan setup failed, we can't return counts
      throw createError({
          statusCode: 500,
          statusMessage: 'Failed to initiate temporary mDNS scan',
          data: error instanceof Error ? error.message : String(error)
      });
  } finally {
    // Stop and destroy the temporary browser and bonjour instance
    if (tempBrowser) {
        try { 
            console.log('[Temporary Scan] Stopping temporary browser...');
            (tempBrowser as Browser).stop(); 
        } catch (e) { 
            console.error('[Temporary Scan] Error stopping browser:', e); 
        }
    }
    if (tempBonjour) {
        try { tempBonjour.destroy(); } catch (e) { console.error('[Temporary Scan] Error destroying temp bonjour:', e); }
    }
  }

  // --- 3. Process Temporary Scan Results --- 
  let servicesAddedCount = 0;
  if (foundDuringScan.length > 0) {
    console.log(`[Temporary Scan] Processing ${foundDuringScan.length} services found...`);
    const updateResults = await Promise.allSettled( // Use allSettled to avoid one failure stopping others
      foundDuringScan.map(serviceInfo => updateStoredServices(serviceInfo))
    );
    
    updateResults.forEach((result, index) => {
        if(result.status === 'fulfilled' && result.value === true) {
            servicesAddedCount++;
        } else if (result.status === 'rejected') {
            console.error(`[Temporary Scan] Error updating storage for ${foundDuringScan[index].name}:`, result.reason);
        }
    });
    console.log(`[Temporary Scan] Finished processing. ${servicesAddedCount} services added/updated in storage.`);
  }

  // --- 4. Return results from the temporary scan --- 
  // Include mention of scan error if one occurred
  const statusMessage = temporaryScanError 
      ? `Temporary scan completed with errors. Found ${foundDuringScan.length}.`
      : `Temporary scan complete. Found ${foundDuringScan.length}.`;

  return {
    status: statusMessage, 
    servicesFoundThisScan: foundDuringScan.length,
    servicesAddedOrUpdated: servicesAddedCount,
  };
}); 