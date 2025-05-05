import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/icon', '@nuxt/fonts', '@nuxt/image'],
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  runtimeConfig: {
    // Private keys are only available on the server
    discordToken: process.env.DISCORD_TOKEN, // Renamed for convention
    discordClientId: process.env.DISCORD_CLIENT_ID, // Added Client ID

    // Public keys that are exposed to the client
    public: {}
  },
  // Nitro storage configuration for persistence
  nitro: {
    storage: {
      minecraft_services: {
        driver: 'fs', // Use file system driver
        base: '.data/kv/minecraft_services' // Optional: specify base directory within .output/.data
      }
      // You can configure other storage mounts here if needed
      // 'db': {
      //   driver: 'redis'
      // }
    }
  }
})