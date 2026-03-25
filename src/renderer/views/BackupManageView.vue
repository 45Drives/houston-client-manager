<template>
    <ManageBackupsView class="h-full flex-1" @openWizard="showWizard = true" />

    <!-- New Backup Wizard (modal overlay) -->
    <div v-if="showWizard" class="fixed inset-0 z-[5] flex items-center justify-center bg-black/50">
        <div class="relative bg-well border border-default rounded-xl shadow-2xl w-[56rem] max-w-[calc(100vw-3rem)] max-h-[80vh] flex flex-col overflow-hidden">
            <!-- Close button -->
            <button class="absolute top-3 right-3 z-10 w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-400 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                @click="closeWizard">
                <XMarkIcon class="w-5 h-5" />
            </button>
            <LocalBackupWizard class="flex-1 min-h-0" />
        </div>
    </div>
</template>

<script setup lang="ts">
import ManageBackupsView from './backupSetupWizard/ManageBackupsView.vue';
import LocalBackupWizard from './backupSetupWizard/LocalBackupWizard.vue';
import { XMarkIcon } from '@heroicons/vue/24/outline';
import { provide, reactive, ref } from 'vue';
import { backUpSetupConfigKey, reviewBackUpSetupKey, closeWizardModalKey } from '../keys/injection-keys';

const showWizard = ref(false);

const setupConfig = reactive({
    backUpTasks: [],
    username: '',
    password: '',
});

provide(backUpSetupConfigKey, setupConfig);
provide(reviewBackUpSetupKey, reactive({ tasks: [] }));

function closeWizard() {
    showWizard.value = false;
    // Reset the config for next use
    setupConfig.backUpTasks = [];
    setupConfig.username = '';
    setupConfig.password = '';
}

provide(closeWizardModalKey, closeWizard);
</script>
