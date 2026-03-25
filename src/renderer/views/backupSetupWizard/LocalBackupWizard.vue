<template>

    <Wizard :id="wizardId" :steps="steps" :onComplete="data => onComplete" :hideHeader="true"
        :hideProgress="true" class="h-full flex-1 text-default bg-well" />

</template>
<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui'
import CreateLocalBackupTaskView from './CreateLocalBackupTaskView.vue'
import EnterSmbCredBackUpSetupView from './EnterSmbCredBackUpSetupView.vue'
import SummaryView from './SummaryView.vue'
import CompleteBackUpCreationView from './CompleteBackUpCreationView.vue'

import { provide, inject } from 'vue'
import { backUpSetupConfigKey, reviewBackUpSetupKey, closeWizardModalKey } from '../../keys/injection-keys'
import { useRouter } from 'vue-router'
const router = useRouter()
const closeWizardModal = inject(closeWizardModalKey, () => router.replace({ name: 'backup-manage' }));

// Config is provided by BackupManageView parent
// Just define local reactive for the wizard
const setup = inject(backUpSetupConfigKey)!;
const review = inject(reviewBackUpSetupKey)!

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

const onComplete = () => closeWizardModal();
provide('wizardKey', wizardId)
</script>
