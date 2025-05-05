import { $fetch } from 'ofetch'; // Using ofetch which is likely available via Nuxt/$fetch

/**
 * Sends a message to a Discord webhook, using a Minecraft username for the name and avatar.
 *
 * @param username The Minecraft username to display and fetch the avatar for.
 * @param message The message content to send.
 * @param webhookUrl The specific Discord webhook URL to use.
 */
export async function sendToDiscord(
    username: string,
    message: string,
    webhookUrl: string | null // <-- Accept webhookUrl as argument
): Promise<void> {

  // Remove environment variable lookup
  // const webhookUrl = process.env.WEBHOOK_URL;

  // Use the passed webhookUrl
  if (!webhookUrl) {
    // Log slightly differently as it comes from config now
    console.warn('[Discord Webhook] Webhook URL is not configured or provided. Skipping message.');
    return;
  }

  if (!username || !message) {
      console.warn('[Discord Webhook] Username or message is empty. Skipping.');
      return;
  }

  // Construct the avatar URL using mc-heads.net
  const avatarUrl = `https://mc-heads.net/head/${encodeURIComponent(username)}`;

  // Prepare the payload for the Discord webhook
  const payload = {
    content: message,
    username: username, // Use the Minecraft username as the webhook username
    avatar_url: avatarUrl,
    // Optional: Add allowed_mentions if you need to control pings
    // allowed_mentions: {
    //   parse: [] // Disables all pings (@everyone, @here, roles, users)
    // }
  };

  try {
    // Use $fetch (or ofetch) to send the POST request
    await $fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    // console.log(`[Discord Webhook] Successfully sent message for user: ${username}`);
  } catch (error: any) {
    // Log detailed error information if possible
    let errorMessage = 'Unknown error';
    if (error.response) {
        // Discord API error
        errorMessage = `Discord API Error: ${error.response.status} - ${JSON.stringify(error.response._data)}`;
    } else if (error.request) {
        // Network error
        errorMessage = 'Network error sending webhook.';
    } else {
        // Other error
        errorMessage = error.message;
    }
    console.error(`[Discord Webhook] Failed to send message for user ${username}: ${errorMessage}`);
     // Optionally log the payload that failed (excluding sensitive parts if any)
     // console.error('[Discord Webhook] Failing Payload:', payload);
  }
} 