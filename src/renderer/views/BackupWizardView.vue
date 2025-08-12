<!-- <template>
    <div class="h-full flex flex-col">
        <BackupsHome v-if="!creating" @create="startCreate" @restore="() => router.push({ name: 'restore' })"
            @logs="() => router.replace({ name: 'backup', query: { view: 'logs' } })" />
        <BackupCreateWizard v-else :mode="mode" :style="style" @done="() => router.replace({ name: 'backup' })" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BackupsHome from './backupSetupWizard/BackupsHome.vue'
import BackupCreateWizard from './backupSetupWizard/BackupCreateWizard.vue'

const route = useRoute()
const router = useRouter()

// /backup?mode=local|remote&style=simple|custom
const creating = computed(() => !!route.query.mode)
const mode = computed(() => (route.query.mode ?? 'local') as 'local' | 'remote')
const style = computed(() => (route.query.style ?? 'simple') as 'simple' | 'custom')

function startCreate(payload: { mode: 'local' | 'remote', style: 'simple' | 'custom' }) {
    router.replace({ name: 'backup', query: payload })
}
</script>
 -->

<template>
    <div class="w-full h-full">
        <BackupWizard id="backup" :onComplete="onComplete" />
    </div>
</template>

<script setup lang="ts">
import BackupWizard from './backupSetupWizard/Wizard.vue'
import { useRouter } from 'vue-router'
const router = useRouter()
const onComplete = () => router.push({ name: 'dashboard' })
</script>
