<template>
    <CardContainer>
      <template #header class="!text-center">
        <div class="flex justify-center text-3xl">Create Simple Backup Plan!</div>
      </template>
  
      <div class="w-9/12 mx-auto text-center">
        <div class="text-center">
          <p class="mb-6 text-2xl">Choose the folders you want to back up the backup and choose how often you want back it up.</p>
        </div>
        <div class="flex flex-col space-y-4 mt-[5rem]" >
          <div class="flex items-center">
            <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
              <label class="text-default font-semibold text-left">Back Up Location</label>
              <CommanderToolTip :message="`This is the designated backup storage location. It is preconfigured and cannot be modified.`" />
            </div>
            <input disabled   :value="backUpSetupConfig.source"
              class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
          </div>
          <div class="flex  py-2">
            <label class="w-[25%] py-2 text-default font-semibold text-start">Back Interval(starts At 9:00AM): </label>
            <select
            class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default"
            >
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          </div>
            <div class="flex items-center mt-[5rem]">
                <button @click="selectFolder" class="absolute btn btn-secondary h-10 w-15"><PlusIcon class="w-6 h-6 text-white-500" /></button>
                <CommanderToolTip class="ml-[4rem]" :message="`Click the plus icon to select a folder for backup. You can add multiple locations by selecting them one at a time.`" />
              <p class=" h-[3rem] text-start ml-[1rem]  px-4 py-4 flex-1 font-semibold text-lg ">   Select a folder to back up to the designated location.</p>
          </div>
    <!-- Hidden File Input -->
    <input
          ref="folderInput"
          type="file"
          webkitdirectory
          directory
          class="hidden"
          @change="handleFolderSelect"
        />
                <!-- Selected Folders List -->
          <div v-if="selectedFolders.length > 0" class="space-y-2 border rounded-lg border-gray-500">
            <div
              v-for="(folder, index) in selectedFolders"
              :key="index"
              class="p-2 "
            >
            <div class="flex items-center m-[1rem]">
              <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
                <label  class="text-default font-semibold text-left">{{folder.name}}</label>
              </div>
              <input :value="folder.path"
                class="bg-default h-[3rem] mr-[1rem] text-default rounded-lg px-4 flex-1 border border-default">
                <button @click="removeFolder(index)" class="btn btn-secondary">
                <MinusIcon class="w-6 h-6 text-white-500" ></MinusIcon>
              </button>

        </div>
            </div>
          </div>


        </div>

  
      </div>
      <!-- Buttons -->
      <template #footer>
        <div>
          <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">Back</button>
  
          <button   
            class="absolute btn right-[1rem] btn-secondary h-20 w-40">
            FINISH
          </button>
        </div>
      </template>
  
    </CardContainer>
  
  </template>
  
  <script setup lang="ts">
  import { CardContainer, CommanderToolTip,confirm } from "@45drives/houston-common-ui";
  import { inject, ref, computed, reactive } from "vue";
  import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
  
  import { useWizardSteps } from '../../components/wizard';
  import type { BackUpSetupConfig } from '@/types';

const backUpSetupConfigKey = Symbol('backUpSetupConfig');

const backUpSetupConfig = inject<BackUpSetupConfig | null>(backUpSetupConfigKey, null);

if (!backUpSetupConfig) {
  throw new Error("❌ BackUpSetupConfig is not provided! Make sure the parent component wraps this component.");
}
  const folderInput = ref<HTMLInputElement | null>(null);
    const selectedFolders = ref<{ name: string; path: string }[]>([]);
const selectFolder = () => {
  if(folderInput.value){
    folderInput.value.click(); // Simulates a click on the hidden input

  }
};
const handleFolderSelect = (event: Event) => {
  const target = event.target as HTMLInputElement; // ✅ Ensure event.target is an input element
  const files = target.files;

  // ✅ Ensure `files` exists and has at least one file
  if (files && files.length > 0) {
    const firstFile = files[0];
    if(firstFile){
    // ✅ Ensure `webkitRelativePath` exists before accessing it
    if (firstFile.webkitRelativePath) {
        const fullPath = firstFile.webkitRelativePath; // Gets the full relative path
        const folderName = fullPath.split("/")[0] ?? "Unknown Folder"; // ✅ Ensure it's always a stringh.split("/")[0]; // Extract folder name
        const folderPath = `/path/to/${folderName}`; // Replace with actual path logic if needed

        // Prevent duplicate folder selection
        if (!selectedFolders.value.some(f => f.name === folderName)) {
          selectedFolders.value.push({ name: folderName, path: folderPath });
        }
    }
    }

  }
};
const removeFolder = (index: number) => {
  selectedFolders.value.splice(index, 1);
};
  const { prevStep, completeCurrentStep } = useWizardSteps();
  
  const proceedToNextStep = async () => {
    completeCurrentStep();
  };
  
  const proceedToPreviousStep = () => {
    console.log("test go back");
    prevStep();
  };
  
  
  // Function when user confirms credentials are saved
  const handleNextClick = async () => {
    const proceed = await confirm({body:'Please ensure you save your username and password in a secure location for future reference. You will not be able to retrieve them later. If you have already saved them, click "OK" to proceed. Otherwise, click "Back" to cancel and securely store your credentials.', 
    header:"Save Your Credentials", confirmButtonText:"OK, Proceed", cancelButtonText:"Back"}).unwrapOr(false);
    console.log("handleConfirm:", proceed); // Debugging log
    if (proceed === true) {
      proceedToNextStep();
    }
    // Proceed to next step logic here
  };
  </script>
  