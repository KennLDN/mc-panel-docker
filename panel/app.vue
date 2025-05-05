<template>
  <div class="relative flex h-screen w-screen overflow-hidden bg-neutral-800">
    <!-- Burger Button for Mobile -->
    <button
      class="absolute left-4 top-4 z-20 text-white sm:hidden"
      @click="toggleSidebar"
    >
      <!-- You can replace this with an actual burger icon component or SVG -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 6h16M4 12h16m-7 6h7"
        />
      </svg>
    </button>

    <!-- Sidebar -->
    <div
      class="absolute z-30 h-full transform transition-transform duration-300 ease-in-out sm:relative sm:translate-x-0"
      :class="{
        '-translate-x-full': !isSidebarOpen,
        'translate-x-0': isSidebarOpen,
      }"
    >
      <ServerBar />
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-y-auto" @click="closeSidebarIfOpen">
      <NuxtPage />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
// If ServerBar is auto-imported by Nuxt, no import is needed here.
// Otherwise, you might need: import ServerBar from '~/components/ServerBar.vue';

const isSidebarOpen = ref(false)

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const closeSidebarIfOpen = () => {
  if (isSidebarOpen.value) {
    isSidebarOpen.value = false
  }
}
</script>
