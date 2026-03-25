<template>
    <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div v-if="title" class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-default">{{ title }}</h2>
            <slot name="header-action" />
        </div>
        <div :class="noPad ? '' : 'px-4 py-3'">
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    title?: string
    noPad?: boolean
}>()
</script>
