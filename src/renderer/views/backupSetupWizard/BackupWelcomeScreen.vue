<template>
  <div class="flex flex-col h-full items-center justify-center text-default p-8 ui-texture-surface ui-texture-surface--soft">
    <div class="max-w-2xl text-center space-y-6">
      <h1 class="text-3xl font-bold">Welcome to the Backup Manager</h1>

      <p class="text-lg leading-relaxed">
        Your data is precious — protect it with the power of backups!
        A backup ensures your files are safe from accidents, failures, and digital mischief.
      </p>

      <p class="text-lg leading-relaxed">
        From here you can create automated backup tasks, monitor their progress,
        restore files from previous backups, and manage snapshots on your storage server.
      </p>

      <p class="text-base text-muted leading-relaxed">
        Anywhere you see this icon:
        <InformationCircleIcon class="w-5 h-5 inline text-muted" />
        it means the Houston Commander has a tip for you. Hover over it to learn more.
      </p>

      <div class="pt-4">
        <button class="btn btn-primary h-fit btn-with-icon" @click="emit('dismiss')">
          Get Started
          <ArrowRightIcon class="w-5 h-5" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowRightIcon, InformationCircleIcon } from '@heroicons/vue/24/outline';
import { useHeader } from '../../composables/useHeader';

useHeader('Welcome to the 45Drives Backup Manager!');

const emit = defineEmits<{ dismiss: [] }>();
</script>
