<template>

    <Wizard :id="wizardId" :steps="steps" :onComplete="data => onComplete" :hideHeader="true"
        :hideProgress="true" class="h-full flex-1 text-default bg-default" />

</template>
<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui'
import CreateLocalBackupTaskView from './CreateLocalBackupTaskView.vue'
import EnterSmbCredBackUpSetupView from './EnterSmbCredBackUpSetupView.vue'
import SummaryView from './SummaryView.vue'
import CompleteBackUpCreationView from './CompleteBackUpCreationView.vue'

import { reactive, provide } from 'vue'
import { backUpSetupConfigKey, reviewBackUpSetupKey } from '../../keys/injection-keys'
import { useRouter } from 'vue-router'
const router = useRouter()

// make planType part of shared config
const setup = reactive({
    planType: null as 'simple' | 'custom' | null,
    backUpTasks: [],
    username: '',
    password: '',
})
provide(backUpSetupConfigKey, setup)
provide(reviewBackUpSetupKey, reactive({ tasks: [] }))

const wizardId = 'backup-new'

const steps: WizardStep[] = [
    {
        label: 'Create Backup Task',
        component: CreateLocalBackupTaskView,
        nextStep: () => 1,
    },
    {
        label: 'Credentials',
        component: EnterSmbCredBackUpSetupView,
        nextStep: () => 2,
        prevStep: () => 0,
    },
    {
        label: 'Summary',
        component: SummaryView,
        nextStep: () => 3,
        prevStep: () => 1,
    },
    {
        label: 'Complete',
        component: CompleteBackUpCreationView,
        prevStep: () => 2,
    },
]

const onComplete = () => router.replace({ name: 'backup-manage' })
provide('wizardKey', wizardId)
</script>
