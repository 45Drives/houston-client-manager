<template>
    <!-- First-time welcome screen -->
    <template v-if="!onboardingReady">
      <!-- loading settings, show nothing -->
    </template>
    <template v-else-if="showWelcome">
      <BackupWelcomeScreen @dismiss="dismissWelcome" />
    </template>
    <template v-else>
      <ManageBackupsView ref="manageRef" class="h-full flex-1" @openWizard="showWizard = true" />
    </template>

    <!-- New Backup Wizard (modal overlay) -->
    <div v-if="showWizard" class="fixed inset-0 z-[5] flex items-center justify-center bg-black/50">
        <div class="relative bg-well border border-default rounded-xl shadow-2xl w-[56rem] h-[40rem] max-w-[calc(100vw-3rem)] max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
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
import BackupWelcomeScreen from './backupSetupWizard/BackupWelcomeScreen.vue';
import LocalBackupWizard from './backupSetupWizard/LocalBackupWizard.vue';
import { XMarkIcon } from '@heroicons/vue/24/outline';
import { provide, reactive, ref, computed } from 'vue';
import { useHeaderTitle } from '../composables/useHeaderTitle';
import { backUpSetupConfigKey, reviewBackUpSetupKey, closeWizardModalKey } from '../keys/injection-keys';
import { useOnboarding } from '../composables/useOnboarding';
import { useSettings } from '../composables/useSettings';

const { onboarding, markDone } = useOnboarding();
const { settings } = useSettings();

const onboardingReady = computed(() => settings.value !== null);
const showWelcome = computed(() => !onboarding.value.backupManagerSeen);

async function dismissWelcome() {
  await markDone('backupManagerSeen');
}

const showWizard = ref(false);
const manageRef = ref<InstanceType<typeof ManageBackupsView> | null>(null);

const setupConfig = reactive({
    backUpTasks: [],
    username: '',
    password: '',
});

provide(backUpSetupConfigKey, setupConfig);
provide(reviewBackUpSetupKey, reactive({ tasks: [] }));

const { setHeaderTitle } = useHeaderTitle();

function closeWizard() {
    showWizard.value = false;
    // Reset the config for next use
    setupConfig.backUpTasks = [];
    setupConfig.username = '';
    setupConfig.password = '';
    // Restore header title since wizard may have changed it
    setHeaderTitle('Backup Manager');
    // Refresh the backup list to pick up newly created tasks
    manageRef.value?.refreshBackups();
}

provide(closeWizardModalKey, closeWizard);
</script>
