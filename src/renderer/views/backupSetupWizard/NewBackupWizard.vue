<template>

    <Wizard :id="wizardId" :steps="steps" :onComplete="data => props.onComplete(data)" :hideHeader="true"
        :hideProgress="true" class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui';
import ChooseDifficultyView from './ChooseDifficultyView.vue';
import CreateSimpleBackUpView from './CreateSimpleBackupView_Local.vue'
import CustomizeBackupView from './CustomizeBackupView_Local.vue';
import CustomizeRemoteBackupView from './CustomizeBackupView_Remote.vue';
import SummaryView from './SummaryView.vue';

import CompleteBackUpCreationView from './CompleteBackUpCreationView.vue';
import { InjectionKey, provide, reactive } from 'vue';
import { backUpSetupConfigKey, reviewBackUpSetupKey } from '../../keys/injection-keys';
import EnterSmbCredBackUpSetupView from './EnterSmbCredBackUpSetupView.vue';
import ChooseBackupType from './ChooseBackupType.vue';
import { useRouter } from 'vue-router'
const router = useRouter()

const props = defineProps<{
    id: string,
    onComplete: (data: any) => void;
}>();

provide(backUpSetupConfigKey, reactive({
    backUpTasks: [],
    username: "",
    password: "",
}))

provide(reviewBackUpSetupKey, reactive({ tasks: [] }))

const wizardId = 'backup-new';
    
const steps: WizardStep[] = [
    // index 0
    { label: "Choose Backup Type", component: ChooseBackupType, nextStep: (data) => (data.choice === 'local' ? 1 : 4) },

    // index 1
    { label: "Choose Local Backup Plan Type", component: ChooseDifficultyView, nextStep: (data) => (data.planType === 'simple' ? 2 : 3), prevStep: () => 0,},

    // index 2
    { label: "Create Simple Local Backup", component: CreateSimpleBackUpView, nextStep: () => 5, prevStep: () => 1, },

    // index 3
    { label: "Create Custom Local BackUp", component: CustomizeBackupView, nextStep: () => 5, prevStep: () => 1, },

    // index 4
    { label: "Create Remote BackUp", component: CustomizeRemoteBackupView, nextStep: () => 5, prevStep: () => 0,},

    // index 5
    // { label: "Credentials", component: EnterSmbCredBackUpSetupView },
    {
        label: "Credentials",
        component: EnterSmbCredBackUpSetupView,
        // (optional) dynamic back if you prefer explicit logic over auto-wiring:
        prevStep: (data) => {
            if (data.choice === 'remote') return 4;
            return data.planType === 'simple' ? 2 : 3;
        }
    },

    // index 6
    { label: "Summary", component: SummaryView },

    // index 7
    { label: "Complete", component: CompleteBackUpCreationView },
];


const onComplete = () => router.push({ name: 'backup' })

provide('wizardKey', wizardId);
</script>

<style scoped></style>
