<template>
  <div class="flex flex-col items-center justify-center w-full mt-4">
    <div class="font-bold text-center text-xl mb-2 border-b-2 border-default pb-1 w-full max-w-md">
      Detected 45Drives Servers
    </div>

    <div v-if="servers.length === 0" class="spinner my-4"></div>

    <table class="table-auto border-collapse border border-default w-full max-w-md">
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
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, withDefaults, defineProps, defineEmits, watch } from 'vue'
import type { Server } from '../types'

// 1) defineProps + withDefaults to make `selectedServer` optional (defaults to null)
const props = withDefaults(
  defineProps<{
    filterOutStorageSetupComplete: boolean
    selectedServer?: Server | null
  }>(),
  { selectedServer: null }
)

// 2) event to send selection back up
const emit = defineEmits<{
  (e: 'serverSelected', srv: Server | null): void
}>()

// 3) manage your discovered servers (unchanged)
const servers = ref<Server[]>([])
window.electron.ipcRenderer.on('discovered-servers', (_e, list: Server[]) => {
  servers.value = props.filterOutStorageSetupComplete
    ? list.filter((s) => s.status !== 'complete')
    : list
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
