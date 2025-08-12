<template>
    <div class="w-full h-full">
        <StorageSetupWizard id="setup" :onComplete="onComplete" />
    </div>
</template>

<script setup lang="ts">
import StorageSetupWizard from './storageSetupWizard/Wizard.vue'
import { useRouter } from 'vue-router'
const router = useRouter()
const onComplete = () => router.push({ name: 'houston' })
</script>
