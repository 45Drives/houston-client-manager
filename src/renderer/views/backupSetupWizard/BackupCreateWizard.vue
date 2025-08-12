<template>
    <Wizard :id="'backup-create'" :steps="steps" :hideHeader="true" :hideProgress="true"
        :onComplete="() => $emit('done')" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Wizard } from '@45drives/houston-common-ui'
import { buildBackupSteps, type BackupMode, type BackupStyle } from './backupStepRegistry'

const props = defineProps<{ mode: BackupMode; style: BackupStyle }>()
const steps = computed(() => buildBackupSteps(props.mode, props.style))
</script>
