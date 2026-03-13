<template>
    <div class="w-full h-full flex items-center justify-center">
        <RestoreBackUpWizard id="restore-backup" :onComplete="() => router.push({ name: 'dashboard' })" />
    </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import RestoreBackUpWizard from './restoreBackupWizard/Wizard.vue'
const router = useRouter()
</script>
