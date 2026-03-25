<template>
  <div class="h-full flex flex-col min-h-0 overflow-hidden bg-well text-default select-none">
    <!-- Mockup toolbar -->
    <div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-default shrink-0">
      <div class="flex items-center gap-2 opacity-50">
        <span class="text-xs text-muted">1 selected</span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
          <PlayIcon class="w-3.5 h-3.5" /> Run Now
        </span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-default text-muted">
          <DocumentTextIcon class="w-3.5 h-3.5" /> Logs
        </span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-default text-muted">
          <PencilSquareIcon class="w-3.5 h-3.5" /> Edit
        </span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-rose-500">
          <TrashIcon class="w-3.5 h-3.5" /> Delete
        </span>
      </div>
      <div class="flex-1" />
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20" data-tour="scheduler-new-btn">
        <PlusIcon class="w-3.5 h-3.5" /> New Backup
      </span>
    </div>

    <!-- Mockup table -->
    <div class="flex-1 overflow-hidden">
      <table class="min-w-full text-sm text-left" data-tour="scheduler-table">
        <thead class="bg-neutral-50 dark:bg-neutral-850 border-b border-default">
          <tr>
            <th class="px-3 py-2 w-10"></th>
            <th class="px-3 py-2 text-xs font-medium text-muted uppercase">Name</th>
            <th class="px-3 py-2 text-xs font-medium text-muted uppercase">Type</th>
            <th class="px-3 py-2 text-xs font-medium text-muted uppercase">Details</th>
            <th class="px-3 py-2 text-xs font-medium text-muted uppercase">Schedule</th>
            <th class="px-3 py-2 text-xs font-medium text-muted uppercase">Status</th>
            <th class="px-3 py-2 text-xs font-medium text-muted uppercase">Last Run</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-default border-l-2 border-l-primary bg-slate-600/5 dark:bg-slate-400/5">
            <td class="px-3 py-2"><div class="w-3.5 h-3.5 rounded-full border-2 border-primary bg-primary/30" /></td>
            <td class="px-3 py-2 font-medium">Daily Documents</td>
            <td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Rsync</span></td>
            <td class="px-3 py-2 text-muted text-xs">admin@192.168.1.10:/data/docs<br/>→ /mnt/tank/backups/docs</td>
            <td class="px-3 py-2 text-muted">Daily</td>
            <td class="px-3 py-2"><span class="inline-flex items-center gap-1.5 text-xs"><span class="w-1.5 h-1.5 rounded-full bg-green-500" />Success</span></td>
            <td class="px-3 py-2 text-muted">2h ago</td>
          </tr>
          <tr class="border-b border-default border-l-2 border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-700/30">
            <td class="px-3 py-2"><div class="w-3.5 h-3.5 rounded-full border-2 border-default" /></td>
            <td class="px-3 py-2 font-medium">Weekly Photos</td>
            <td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Cloud Sync</span></td>
            <td class="px-3 py-2 text-muted text-xs">backblaze-b2:photos-bucket<br/>→ /mnt/tank/photos</td>
            <td class="px-3 py-2 text-muted">Weekly</td>
            <td class="px-3 py-2"><span class="inline-flex items-center gap-1.5 text-xs"><span class="w-1.5 h-1.5 rounded-full bg-gray-400" />Idle</span></td>
            <td class="px-3 py-2 text-muted">3d ago</td>
          </tr>
          <tr class="border-b border-default border-l-2 border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-700/30">
            <td class="px-3 py-2"><div class="w-3.5 h-3.5 rounded-full border-2 border-default" /></td>
            <td class="px-3 py-2 font-medium">Nightly DB Sync</td>
            <td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Rsync</span></td>
            <td class="px-3 py-2 text-muted text-xs">root@10.0.0.5:/var/lib/postgres<br/>→ /mnt/tank/db-backups</td>
            <td class="px-3 py-2 text-muted">Daily</td>
            <td class="px-3 py-2"><span class="inline-flex items-center gap-1.5 text-xs"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />Running</span></td>
            <td class="px-3 py-2 text-muted">Running…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mockup progress strip -->
    <div class="px-3 py-2 border-t border-default bg-accent shrink-0">
      <div class="flex items-center gap-3">
        <span class="text-xs font-medium text-muted">1 backup in progress</span>
        <div class="flex-1 flex items-center gap-2 min-w-0">
          <span class="text-xs text-default truncate">Nightly DB Sync</span>
          <div class="flex-1 h-1.5 bg-well rounded-full overflow-hidden">
            <div class="h-full bg-primary rounded-full w-[65%]" />
          </div>
          <span class="text-xs text-muted">65%</span>
        </div>
      </div>
    </div>

    <!-- MOCKUP watermark -->
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span class="text-6xl font-bold text-muted/10 rotate-[-15deg] select-none">PREVIEW</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  PlayIcon, PlusIcon, PencilSquareIcon,
  DocumentTextIcon, TrashIcon,
} from '@heroicons/vue/24/outline';
</script>
