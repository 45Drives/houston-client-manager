<template>

    <Wizard :id="wizardId" :steps="steps" :onComplete="data => props.onComplete(data)" :hideHeader="true"
        :hideProgress="true" class="h-full flex-1 text-default bg-default" />

</template>
<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui'
import ChooseDifficultyView from './ChooseDifficultyView.vue'
import CreateSimpleBackUpView from './CreateSimpleBackupView_Local.vue'
import CustomizeBackupView from './CustomizeBackupView_Local.vue'
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
        label: 'Choose Local Backup Plan Type',
        component: ChooseDifficultyView,
        nextStep: (data: any) => {
            // capture the choice globally so later steps can see it
            setup.planType = data.planType
            return data.planType === 'simple' ? 1 : 2
        },
    },
    {
        label: 'Create Simple Local Backup',
        component: CreateSimpleBackUpView,
        nextStep: () => 3,
        prevStep: () => 0,
    },
    {
        label: 'Create Custom Local Backup',
        component: CustomizeBackupView,
        nextStep: () => 3,
        prevStep: () => 0,
    },
    {
        label: 'Credentials',
        component: EnterSmbCredBackUpSetupView,
        nextStep: () => 4,
        // use the shared state instead of the step's local data
        prevStep: () => (setup.planType === 'simple' ? 1 : 2),
    },
    {
        label: 'Summary',
        component: SummaryView,
        nextStep: () => 5,
        prevStep: () => 3,
    },
    {
        label: 'Complete',
        component: CompleteBackUpCreationView,
        prevStep: () => 4,
    },
]

const onComplete = () => router.push({ name: 'backup' })
provide('wizardKey', wizardId)
</script>
