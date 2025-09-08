<template>
  <div class="flex flex-col items-center justify-center w-full mt-4">
    <div class="font-bold text-center text-xl mb-2 border-b-2 border-default pb-1 w-full max-w-md">
      Detected 45Drives Servers
    </div>
    <div class="w-full max-w-lg overflow-y-auto max-h-52 border-collapse border border-default">
      <table class="table-auto border-collapse border border-default w-full max-w-lg">
        <thead>
          <tr class="bg-accent">
            <th class="border border-default p-2 text-center">Select</th>
            <th class="border border-default p-2 text-center">Name</th>
            <th class="border border-default p-2 text-center">IP Address</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="srv in servers" :key="srv.ip" class="hover:bg-accent cursor-pointer" @click="onSelect(srv)"
            :class="{ 'bg-accent': isSelected(srv) }">
            <td class="border border-default p-2 text-center">
              <input type="checkbox" :checked="isSelected(srv)" @click.stop="onSelect(srv)"
                class="form-checkbox h-5 w-5 text-blue-600" />
            </td>
            <td class="border border-default p-2 text-center">{{ srv.name }}</td>
            <td class="border border-default p-2 text-center">{{ srv.ip }}</td>
          </tr>
          <tr v-if="servers.length === 0" class="flex flex-row items-center text-center">
            <!-- show spinner while loading -->
            <div v-if="!showNoServers" class="spinner my-4"></div>

            <!-- show no servers message after timeout -->
            <div v-else-if="showNoServers" class="my-4 text-muted">
              No servers detected.
            </div>

          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, withDefaults, defineProps, defineEmits, watch, inject, computed, onMounted } from 'vue'
import type { Server, DiscoveryState } from '../types'
import { discoveryStateInjectionKey } from '../keys/injection-keys';

// 1) defineProps + withDefaults to make `selectedServer` optional (defaults to null)
const props = withDefaults(
  defineProps<{
    filterOutStorageSetupComplete: boolean;
    filterOutNonSetupServers: boolean;
    selectedServer?: Server | null;
  }>(),
  { selectedServer: null }
)

// 2) event to send selection back up
const emit = defineEmits<{
  (e: 'serverSelected', srv: Server | null): void
}>()

// 3) manage your discovered servers
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
// const servers = computed(() => discoveryState.servers)


const servers = computed(() => {
  if (props.filterOutNonSetupServers) {
    return discoveryState.servers.filter(server => 
      server.setupComplete === true &&
      server.status === 'complete'
    )
  } else if (props.filterOutStorageSetupComplete) {
    return discoveryState.servers.filter(server =>
      server.setupComplete === false &&
      server.status === 'not complete'
    )
  } else {
    return discoveryState.servers;
  }
})

// state to track whether to show "no servers detected"
const showNoServers = ref(false)

// when component mounts, start a timeout to switch to "no servers" message
onMounted(() => {
  setTimeout(() => {
    if (servers.value.length === 0) {
      showNoServers.value = true
    }
  }, 5000) // 5s timeout
})

// watch server list; if servers appear, cancel the no-servers message
watch(servers, (list) => {
  if (list.length > 0) {
    showNoServers.value = false
  }
})

// 4) helper to test if this row is selected
const isSelected = (srv: Server) =>
  props.selectedServer?.ip === srv.ip

// 5) on click, toggle; emit null to unselect
function onSelect(srv: Server) {
  const next = isSelected(srv) ? null : srv
  emit('serverSelected', next)
}
</script>

<style scoped></style>
