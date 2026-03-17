<template>
  <nav class="flex items-center gap-1 text-sm text-muted" aria-label="Breadcrumb">
    <template v-for="(crumb, i) in crumbs" :key="crumb.path">
      <button
        v-if="i < crumbs.length - 1"
        class="hover:text-default hover:underline transition-colors"
        @click="router.push(crumb.path)"
      >
        {{ crumb.label }}
      </button>
      <span v-else class="text-default font-medium">{{ crumb.label }}</span>
      <ChevronRightIcon v-if="i < crumbs.length - 1" class="w-3.5 h-3.5 text-muted/60 shrink-0" />
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRightIcon } from '@heroicons/vue/20/solid'

const route = useRoute()
const router = useRouter()

type Crumb = { label: string; path: string }

const breadcrumbMap: Record<string, Crumb[]> = {
  dashboard: [{ label: 'Dashboard', path: '/' }],
  setup: [
    { label: 'Dashboard', path: '/' },
    { label: 'Server Setup', path: '/setup' },
  ],
  'backup-manage': [
    { label: 'Dashboard', path: '/' },
    { label: 'Backup Manager', path: '/backup/manage' },
  ],
  'create-new-backup': [
    { label: 'Dashboard', path: '/' },
    { label: 'Backup Manager', path: '/backup/manage' },
    { label: 'New Backup', path: '/backup/new' },
  ],
  'view-selected-backups': [
    { label: 'Dashboard', path: '/' },
    { label: 'Backup Manager', path: '/backup/manage' },
    { label: 'View Backup', path: '/backup/view' },
  ],
  houston: [
    { label: 'Dashboard', path: '/' },
    { label: 'Server Setup', path: '/setup' },
    { label: 'Houston', path: '/houston' },
  ],
}

const crumbs = computed<Crumb[]>(() => {
  const name = route.name as string
  return breadcrumbMap[name] ?? [{ label: 'Dashboard', path: '/' }]
})
</script>
