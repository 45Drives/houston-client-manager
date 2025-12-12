<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <!-- Header -->
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
        <DynamicBrandingLogo :division="division" :height="(division === 'studio' ? 16 : 12)"/>

        </div>
        <p class="text-3xl font-semibold text-center">
          Server Credentials
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <!-- Main Content -->
    <div class="flex flex-col gap-8 px-8 py-6 text-default text-center items-center">
      <!-- Instruction -->
      <p class="text-lg text-center">
        Please provide your server, username and password for the backup you want to access.
      </p>

      <!-- Credential Form Layout -->
      <div class="flex flex-col lg:flex-row gap-10 w-full justify-center items-center">
        <!-- Server Selection -->
        <div class="w-full lg:w-2/5">
          <HoustonServerListView class="w-full text-xl" 
            @serverSelected="handleServerSelected" :selectedServer="restoreBackUpData.server" :filterMode="'onlyComplete'"/>
        </div>

        <!-- Username & Password -->
         <!-- Username & Password -->
        <form @submit.prevent="proceedToNextStep" class="flex flex-col gap-4 mt-4 text-default text-left">
          <div class="grid relative grid-cols-[200px_1fr] items-center">
            <label for="username" class="block mb-1 font-medium text-lg">Username</label>
            <input v-model="restoreBackUpData.username" v-enter-next type="text" id="username"
              class="bg-default p-3 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              placeholder="Enter your username" />
          </div>

          <div class="grid relative grid-cols-[200px_1fr] items-center">
            <label for="password" class="block mb-1 font-medium text-lg">Password</label>
            <input v-model="restoreBackUpData.password" v-enter-next :type="showPassword ? 'text' : 'password'"
              id="password"
              class="bg-default p-3 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              placeholder="Enter your password" />
            <button type="button" @click="togglePassword"
              class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
              <EyeIcon v-if="!showPassword" class="w-5 h-5" />
              <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
            </button>
          </div>

          <!-- Error message -->
          <p v-if="authError" class="text-red-500 text-sm mt-2 col-span-2 text-right">
            {{ authError }}
          </p>

          <!-- Optional: small status while validating -->
          <p v-if="openingBackup" class="text-sm text-muted mt-1">
            Validating credentials…
          </p>

          <button type="submit" class="hidden">Submit</button>
        </form>

      </div>
    </div>

    <!-- Footer Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <div class="button-group-row w-full justify-between">

          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

          <button :disabled="isButtonDisabled" @click="proceedToNextStep" class="btn btn-primary w-40 h-20">
            Next
          </button>

        </div>
      </div>
    </template>
  </CardContainer>
</template>


<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { CardContainer, useWizardSteps, DynamicBrandingLogo, useAutoFocus, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey, restoreBackUpSetupDataKey } from '../../keys/injection-keys';
import HoustonServerListView from '../../components/HoustonServerListView.vue';
import { Server } from '../../types';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { IPCRouter } from '@45drives/houston-common-lib';

useAutoFocus();

const division = inject(divisionCodeInjectionKey);
const restoreBackUpData = inject(restoreBackUpSetupDataKey)!;
const { prevStep, nextStep } = useWizardSteps("restore-backup");

const openingBackup = ref(false);
const showPassword = ref(false);
const authError = ref<string | null>(null);

const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

// Disable Next if form incomplete or we are currently validating
const isButtonDisabled = computed(() =>
  !restoreBackUpData?.username ||
  !restoreBackUpData?.password ||
  !restoreBackUpData.server ||
  openingBackup.value
);

const handleServerSelected = async (server: Server | null) => {
  restoreBackUpData.server = server;
};

const proceedToPreviousStep = async () => {
  prevStep();
};

// One-time IPC handler for mount result
const router = IPCRouter.getInstance();
let mountedHandler: ((data: string) => void) | null = null;

onMounted(() => {
  mountedHandler = (data: string) => {
    try {
      const message = JSON.parse(data);

      if (message.action === "mountSmbResult") {
        openingBackup.value = false;

        const res = message.result || {};

        if (!res.success) {
          authError.value =
            "Failed to connect to the backup share. Please check the server, username, and password.";
          return;
        }

        authError.value = null;
        nextStep();
      }
    } catch {
      // ignore unrelated / malformed messages
    }
  };

  router.addEventListener("action", mountedHandler);
});

onBeforeUnmount(() => {
  // Clean up listener if IPCRouter supports removal
  if (mountedHandler && (router as any).removeEventListener) {
    (router as any).removeEventListener("action", mountedHandler);
  }
});

// When user clicks Next or presses Enter:
// 1) validate locally
// 2) ask backend to try mounting (with these credentials)
// 3) only advance on success (handled in the IPC listener above)
const proceedToNextStep = () => {
  if (isButtonDisabled.value) return;

  authError.value = null;
  openingBackup.value = true;

  const host = (restoreBackUpData.server?.serverName ?? "") + ".local";
  const share = restoreBackUpData.server?.shareName ?? "";

  router.send("backend", "mountSambaClient", {
    smb_host: host,
    smb_share: share,
    smb_user: restoreBackUpData.username,
    smb_pass: restoreBackUpData.password,
  });
};

useEnterToAdvance(
  () => {
    if (!isButtonDisabled.value) {
      proceedToNextStep(); // Enter
    }
  },
  200,
  () => {
    if (!isButtonDisabled.value) {
      proceedToNextStep(); // ArrowRight
    }
  },
  () => {
    proceedToPreviousStep(); // ArrowLeft
  }
);
</script>
