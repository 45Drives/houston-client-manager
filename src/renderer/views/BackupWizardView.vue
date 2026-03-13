<template>
    <Wizard :id="'backup-root'" :steps="steps" :onComplete="onComplete" :hideHeader="true" :hideProgress="true"
        class="h-full flex-1 text-default bg-default" />
</template>

<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui';
import WelcomeView from './backupSetupWizard/WelcomeView.vue';
import ManageBackupsView from './backupSetupWizard/ManageBackupsView.vue';
import BackupBrowser from './backupSetupWizard/BackupBrowser.vue';
import { useRouter } from 'vue-router'
import { provide, reactive } from 'vue';
import { backUpSetupConfigKey, reviewBackUpSetupKey } from '../keys/injection-keys';

const router = useRouter()

const steps: WizardStep[] = [
    { label: 'Welcome', component: WelcomeView },
    { label: 'Backup Manager', component: ManageBackupsView },
    // { label: 'Backup Browser', component: BackupBrowser },
];
const onComplete = () => router.push({ name: 'dashboard' })

provide(backUpSetupConfigKey, reactive({
    backUpTasks: [],
    username: "",
    password: "",
}))

provide(reviewBackUpSetupKey, reactive({ tasks: [] }))
</script>
