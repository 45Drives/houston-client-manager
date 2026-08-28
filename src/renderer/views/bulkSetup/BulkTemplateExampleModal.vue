<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="$emit('close')">
    <div
      class="bg-default rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col text-left">
      <div class="flex items-start justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-700">
        <div>
          <h2 class="text-base font-semibold text-default">Bulk Setup Template Example</h2>
          <p class="text-xs text-muted mt-0.5">
            Save this as a <code>.json</code> file, fill in your own values, then use <strong>Import Template</strong>.
          </p>
        </div>
        <button class="text-muted hover:text-default" title="Close" @click="$emit('close')">
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <pre
          class="text-xs font-mono bg-well text-default rounded-lg p-3 overflow-x-auto border border-neutral-200 dark:border-neutral-700">{{ exampleJson }}</pre>

        <div>
          <h3 class="text-sm font-semibold text-default mb-2">Fields</h3>
          <dl class="text-xs space-y-1.5">
            <div v-for="f in fields" :key="f.key" class="flex gap-2">
              <dt class="font-mono text-default w-40 shrink-0">{{ f.key }}</dt>
              <dd class="text-muted">{{ f.desc }}</dd>
            </div>
          </dl>
        </div>

        <p class="text-xs text-muted">
          Passwords are never written to an exported template and are ignored on import — enter them in the app, or fill
          them into Global Defaults after importing.
        </p>
      </div>

      <div class="flex justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-700">
        <button class="btn btn-secondary h-fit px-3 py-2 text-sm" @click="copy">
          {{ copied ? 'Copied' : 'Copy JSON' }}
        </button>
        <button class="btn btn-secondary h-fit px-3 py-2 text-sm" @click="download">Download Example</button>
        <button class="btn btn-primary h-fit px-3 py-2 text-sm" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
// Inlined at build time so the example ships with the packaged app.
import exampleJson from '../../../../docs/bulk-setup-template-example.json?raw'

defineEmits<{ (e: 'close'): void }>()

const copied = ref(false)

const fields = [
  { key: 'version', desc: 'Template format version. Always 1.' },
  { key: 'host', desc: 'IP address or hostname of the target server.' },
  { key: 'username', desc: 'SSH login used for setup. Usually root.' },
  { key: 'password', desc: 'Leave empty — supply it in the app or via Global Defaults.' },
  { key: 'mode', desc: '"simple" for best-practice defaults, or "custom" for full control.' },
  { key: 'serverName', desc: 'Hostname to assign. Letters, numbers and dashes only.' },
  { key: 'shareName', desc: 'Name of the Samba share to create.' },
  { key: 'smbUser', desc: 'File-sharing account created on the server.' },
  { key: 'smbPass', desc: 'Leave empty — supply it in the app or via Global Defaults.' },
  { key: 'clearExistingData', desc: 'Destroy existing ZFS pools and Samba shares first. Defaults to false.' },
  { key: 'splitPools', desc: 'Optional. Split drives into storage + backup pools. Needs 6+ drives.' },
  { key: 'wipeDrives', desc: 'Optional. Quick-wipe drives carrying old partitions or signatures.' },
]

async function copy() {
  try {
    await navigator.clipboard.writeText(exampleJson)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    copied.value = false
  }
}

function download() {
  const blob = new Blob([exampleJson], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bulk-setup-template-example.json'
  a.click()
  URL.revokeObjectURL(url)
}
</script>
