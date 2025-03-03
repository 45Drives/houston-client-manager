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
          <div class="flex items-center">
            <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
              <label class="text-default font-semibold text-left">Back Up Location</label>
              <CommanderToolTip 
                :message="`This is the designated backup storage location. It is preconfigured and cannot be modified.`" 
              />
            </div>
            <input 
              disabled 
              :value="backUpFolder"
              class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default" 
            />
          </div>
  
          <div class="flex py-2">
            <label class="w-[25%] py-2 text-default font-semibold text-start">
              Back Interval (Starts At 9:00 AM):
            </label>
            <select v-model="scheduleFrequency" class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
  
          <!-- Folder Selection Button -->
          <div class="flex items-center mt-[5rem]">
            <button @click="handleFolderSelect" class="relative btn btn-secondary h-10 w-15">
              <PlusIcon class="w-6 h-6 text-white-500" />
            </button>
            <CommanderToolTip 
              class="ml-[4rem]" 
              :message="`Click the plus icon to select a folder for backup. You can add multiple locations by selecting them one at a time.`" 
            />
            <p class="h-[3rem] text-start ml-[1rem] px-4 py-4 flex-1 font-semibold text-lg">
              Select a folder to back up to the designated location.
            </p>
          </div>
  
          <!-- Selected Folders List -->
          <div v-if="selectedFolders.length > 0" class="space-y-2 border rounded-lg border-gray-500">
            <div 
              v-for="(folder, index) in selectedFolders" 
              :key="index" 
              class="p-2"
            >
              <div class="flex items-center m-[1rem]">
                <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
                  <label class="text-default font-semibold text-left">{{ folder.name }}</label>
                </div>
                <input 
                  disabled :value="folder.path"
                  class="bg-default h-[3rem] mr-[1rem] text-default rounded-lg px-4 flex-1 border border-default"
                />
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
          <button @click="proceedToNextStep" class="absolute btn right-[1rem] btn-secondary h-20 w-40">
            Next
          </button>
        </div>
      </template>
    </CardContainer>
  </template>
  
  <script setup lang="ts">
  import { CardContainer, CommanderToolTip, confirm } from "@45drives/houston-common-ui";
  import { ref, watch } from "vue";
  import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
  import { useWizardSteps } from '../../components/wizard';
  import { BackUpSetupConfigGlobal } from './BackUpSetupConfigGlobal';
  
  // Wizard navigation
  const { completeCurrentStep, prevStep } = useWizardSteps("backup");
  
  // Reactive State
  const backUpTasks = ref<BackUpTask[]>(BackUpSetupConfigGlobal.getInstance().backUpTasks);
  const selectedFolders = ref<{ name: string; path: string }[]>([]);
  const backUpFolder = "/hl4-test/backup";
  const scheduleFrequency = ref<string>("daily");
  
  // ✅ Watch and Update Tasks When Schedule Changes
  watch(scheduleFrequency, (newSchedule) => {
    backUpTasks.value.forEach((task) => {
      task.schedule.repeatFrequency = newSchedule;
    });
  });
  
  const isSelectingFolder = ref(false); // ✅ Track if dialog is open

    const handleFolderSelect = async () => {
    if (!window.electron?.selectFolder) {
        console.error("Electron API not available! Ensure preload script is loaded.");
        return;
    }

    if (isSelectingFolder.value) return; // ✅ Prevent multiple dialogs from opening
    isSelectingFolder.value = true;

    try {
        const folderPath = await window.electron.selectFolder();
        if (folderPath) {
        const folderName = folderPath.split("/").pop() ?? "Unknown Folder";

        // ✅ Prevent duplicate folder selection
        if (!backUpTasks.value.some(task => task.source === folderPath)) {
            const newTask: BackUpTask = {
            schedule:{startDate: new Date(),repeatFrequency: scheduleFrequency.value},
            description: `Backup task for ${folderName}`,
            source: folderPath, // ✅ Full Folder Path
            target: backUpFolder,
            mirror: false,
            };

            // ✅ Add to backup list
            backUpTasks.value.push(newTask);
            selectedFolders.value.push({ name: folderName, path: folderPath });

            console.log("Backup Tasks:", backUpTasks.value);
        } else {
            console.warn(`Folder "${folderPath}" is already selected.`);
        }
        }
    } catch (error) {
        console.error("Error selecting folder:", error);
    } finally {
        isSelectingFolder.value = false; // ✅ Allow opening new dialogs
    }
    };

  
  // ✅ Remove Folder from List
  const removeFolder = (index: number) => {
    const folderToRemove = selectedFolders.value[index];
  
    // Remove from selectedFolders (UI List)
    selectedFolders.value.splice(index, 1);
  
    // Remove from backUpTasks (Backup Task List)
    const taskIndex = backUpTasks.value.findIndex(task => task.source === folderToRemove.path);
    if (taskIndex !== -1) {
      backUpTasks.value.splice(taskIndex, 1);
    }
  };
  
  // ✅ Proceed to Next Step
  const proceedToNextStep = async () => {
    completeCurrentStep();
  };
  
  // ✅ Proceed to Previous Step
  const proceedToPreviousStep = () => {
    prevStep(2);
  };
  </script>
  