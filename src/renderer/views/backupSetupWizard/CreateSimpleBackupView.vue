<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="flex justify-center text-3xl">Create Simple Backup Plan!</div>
    </template>

    <div class="w-9/12 mx-auto text-center">
      <div class="text-center">
        <p class="mb-6 text-2xl">
          Choose the folders you want to back up and choose how often you want to back it up.
        </p>
      </div>

      <div class="flex flex-col space-y-4 mt-[5rem]">
        <!-- Backup Location -->
        <div class="flex items-center">
          <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
            <label class="text-default font-semibold text-left">Back Up Location</label>
            <CommanderToolTip
              :message="`This is the designated backup storage location. It is preconfigured and cannot be modified.`" />
          </div>
          <select v-model="selectedServer"
            class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
            <option v-for="item in servers" :key="item.ip" :value="item">
              {{ `\\\\${item.name}\\backup` }}
            </option>
          </select>
        </div>

        <!-- Backup Frequency -->
        <div class="flex py-2">
          <label class="w-[25%] py-2 text-default font-semibold text-start">
            Back Interval (Starts At 9:00 AM):
          </label>
          <select v-model="scheduleFrequency"
            class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
            <option value="hour">Hourly</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>

        <!-- Folder Selection Button -->
        <div class="flex items-center mt-[5rem]">
          <button @click="handleFolderSelect" class="relative btn btn-secondary h-10 w-15">
            <PlusIcon class="w-6 h-6 text-white-500" />
          </button>
          <CommanderToolTip class="ml-[4rem]"
            :message="`Click the plus icon to select a folder for backup. You can add multiple locations by selecting them one at a time.`" />
          <p class="h-[3rem] text-start ml-[1rem] px-4 py-4 flex-1 font-semibold text-lg">
            Select a folder to back up to the designated location.
          </p>
        </div>

        <!-- Selected Folders List -->
        <div v-if="selectedFolders.length > 0" class="space-y-2 border rounded-lg border-gray-500">
          <div v-for="(folder, index) in selectedFolders" :key="folder.path" class="p-2">
            <div class="flex items-center m-[1rem]">
              <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
                <label class="text-default font-semibold text-left">{{ folder.name }}</label>
              </div>
              <input disabled :value="folder.path"
                class="bg-default h-[3rem] mr-[1rem] text-default rounded-lg px-4 flex-1 border border-default" />
              <button @click="removeFolder(index)" class="btn btn-secondary">
                <MinusIcon class="w-6 h-6 text-white-500"></MinusIcon>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div>
        <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">
          Back
        </button>
        <button :disabled="backUpSetupConfig?.backUpTasks.length === 0" @click="proceedToNextStep"
          class="absolute btn right-[1rem] btn-secondary h-20 w-40">
          Next
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip } from "@45drives/houston-common-ui";
import { inject, ref, watch } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
import { useWizardSteps } from '../../components/wizard';
import { BackUpSetupConfigGlobal } from './BackUpSetupConfigGlobal';
import { BackUpTask } from "@45drives/houston-common-lib";
import { Server } from '../../types'
import { backUpSetupConfigKey } from "../../keys/injection-keys";

// Wizard navigation
const { completeCurrentStep, prevStep } = useWizardSteps("backup");

// Reactive State
const backUpSetupConfig = inject(backUpSetupConfigKey);//ref<BackUpTask[]>(BackUpSetupConfigGlobal.getInstance().backUpTasks as BackUpTask[]);

const selectedFolders = ref<{ name: string; path: string }[]>([]);
const scheduleFrequency = ref<"hour" | "day" | "week" | "month">("hour");

const servers = ref<Server[]>([]);
const selectedServer = ref<Server | null>(null);

// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  servers.value = discoveredServers;
  if (discoveredServers.length > 0) {

    selectedServer.value = discoveredServers[0];
  }
});

// ✅ Watch and Update Tasks When Schedule Changes
watch(scheduleFrequency, (newSchedule) => {

  if (backUpSetupConfig) {

    backUpSetupConfig.backUpTasks = backUpSetupConfig.backUpTasks.map((task) => {
      task.schedule.repeatFrequency = newSchedule;
      return task;
    });
  }
});

// ✅ Folder Selection
const handleFolderSelect = async () => {
  if (!window.electron?.selectFolder) {
    console.error("Electron API not available! Ensure preload script is loaded.");
    return;
  }

  try {
    const folderPath = await window.electron.selectFolder();
    if (!folderPath) return;

    const folderName = folderPath.split("/").pop() ?? "Unknown Folder";

    if (backUpSetupConfig) {

      // ✅ Prevent Duplicate Folder Selection (Case-Insensitive)
      if (!backUpSetupConfig?.backUpTasks.some(task => task.source.trim().toLowerCase() === folderPath.trim().toLowerCase())) {
        const newTask: BackUpTask = {
          schedule: { startDate: new Date(), repeatFrequency: scheduleFrequency.value },
          description: `Backup task for ${folderName}`,
          source: folderPath,
          target: `\\\\${selectedServer.value?.name}.local\\backup`,
          mirror: false,
        };

        const newBackUpTasks = [...backUpSetupConfig?.backUpTasks];
        newBackUpTasks.push(newTask);
        backUpSetupConfig.backUpTasks = newBackUpTasks;
        selectedFolders.value.push({ name: folderName, path: folderPath });
      }
    }
  } catch (error) {
    console.error("Error selecting folder:", error);
  }
};

// ✅ Remove Folder from List
const removeFolder = (index: number) => {
  selectedFolders.value.splice(index, 1);
  if (backUpSetupConfig) {
    const newBackUpTasks = [...backUpSetupConfig?.backUpTasks];
    newBackUpTasks.splice(index, 1);
    backUpSetupConfig.backUpTasks = newBackUpTasks;
  }
};

// Navigation
const proceedToNextStep = () => completeCurrentStep();
const proceedToPreviousStep = () => prevStep();
</script>
