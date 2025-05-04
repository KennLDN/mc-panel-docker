<template>
  <div class="flex h-screen w-screen bg-neutral-800">
    <ServerBar />
    <div class="flex-1 overflow-y-auto">
      <NuxtPage />
    </div>
  </div>
</template>

<script setup lang="ts">
// If ServerBar is auto-imported by Nuxt, no import is needed here.
// Otherwise, you might need: import ServerBar from '~/components/ServerBar.vue';
</script>
