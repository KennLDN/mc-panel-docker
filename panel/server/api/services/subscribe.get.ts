import { defineEventHandler, setHeader, H3Event } from 'h3';
import { useStorage } from 'nitropack/runtime';
import type { DiscoveredService } from '../../utils/mdnsUtils'; // Corrected import path
// import type { StorageWatchEvent } from 'unstorage'; // Import storage watch event type - Removed

// Define a compatible type for the watch event
type StorageWatchEvent = 'update' | 'remove' | 'clear' | 'mount' | 'unmount'; // Keep local type

// Type for the clean name mapping
type CleanNameMap = Record<string, string>;

// Define the structure for SSE data
interface ServiceUpdate {
  name: string;
  status: string;
  cleanName: string | null;
}

export default defineEventHandler(async (event: H3Event) => {
  const storage = useStorage('minecraft_services');

  // Set headers for SSE
  setHeader(event, 'Content-Type', 'text/event-stream');
  setHeader(event, 'Cache-Control', 'no-cache');
  setHeader(event, 'Connection', 'keep-alive');

  // Function to send data to the client
  // Updated: Send name, status, and cleanName
  const sendServiceUpdates = async (services: DiscoveredService[]) => {
    const cleanNames = (await storage.getItem<CleanNameMap>('clean_names')) || {};
    const serviceUpdates: ServiceUpdate[] = services.map(service => ({
      name: service.name,
      status: service.status ?? 'up', // Default to 'up' if status is somehow undefined
      cleanName: cleanNames[service.name] || null
    }));
    // Note the double newline \n\n which is required by SSE
    event.node.res.write(`data: ${JSON.stringify(serviceUpdates)}\n\n`);
    // Flushing is often handled by the server/Node.js automatically or not available.
    // Removing the explicit flush call.
  };

  // Send the initial list immediately
  const initialServices = (await storage.getItem<DiscoveredService[]>('discovered')) || [];
  // Send name, status, and cleanName initially
  await sendServiceUpdates(initialServices);

  // Watch for changes in storage
  // Define the watcher callback type explicitly
  const watchCallback = async (eventType: StorageWatchEvent, key: string) => {
    // Only react to changes on the specific key we care about
    if (key === 'minecraft_services:discovered' || key === 'minecraft_services:clean_names') { // Also watch clean_names key
      console.log(`Storage key '${key}' changed (${eventType}). Sending update to client.`);
      const updatedServices = (await storage.getItem<DiscoveredService[]>('discovered')) || [];
      // Ensure the response is still writable before sending
      if (!event.node.res.writableEnded) {
        // Send name, status, and cleanName on update
        await sendServiceUpdates(updatedServices);
      }
    }
  };

  const unwatch = await storage.watch(watchCallback);

  // Clean up watcher when the client disconnects
  event.node.req.on('close', async () => {
    console.log('Client disconnected. Stopping storage watcher.');
    await unwatch(); // Call the unwatch function
    // Ensure the response stream is properly closed if not already ended
    if (!event.node.res.writableEnded) {
       event.node.res.end();
    }
  });

  // Prevent the handler from closing immediately
  event._handled = true; // Tell H3 this route handler will manage the response termination

  // Keep the connection open. No need for an unresolved promise with event._handled = true
}); 