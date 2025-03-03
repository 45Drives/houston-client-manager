<template>
    <CardContainer>
      <template #header class="!text-center">
        <div class="flex justify-center text-3xl">Summary</div>
      </template>

      <div class="w-9/12 mx-auto text-center">
        <p class="mb-6 text-2xl">
          You're almost finished! A summary of information can be found below. <br/>
          If everything looks accurate, click <span class="font-bold">Next</span> to set up your storage server. <br/>
          If you'd like to make changes, click <span class="font-bold">Back.</span>
        </p>

        <div class="flex flex-col space-y-4 mt-[5rem]">
          <div class="flex items-center">
            <div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
              <label class="text-default font-semibold text-left">Back Up Location</label>
              <CommanderToolTip :message="`This is the designated backup storage location. It is preconfigured and cannot be modified.`" />
            </div>
            <input disabled value="/hl4-test/backup"
              class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
          </div>
        </div>

        <!-- Folder Selection -->
        <div class="flex flex-col space-y-4 mt-[2rem]">
            <div v-for="(task, index) in backUpTasks" :key="index" class="flex items-center">
                <div class="text-start w-[50%]">
                <label class="text-default font-semibold text-left">Folder:</label>
                <input 
                    :value="task.source"
                    class="bg-default h-[3rem] w-[70%] ml-[2rem] text-default rounded-lg px-4 flex-1 border border-default"
                    disabled
                />
                </div>
                <div class="text-start w-[50%] flex items-center">
                <label class="text-default font-semibold text-left">When:</label>
                <input 
                    disabled 
                    :value="`Backup will happen ${task.schedule.repeatFrequency} at 9:00 AM`"
                    class="bg-default h-[3rem] w-[70%] ml-[2rem] text-default rounded-lg px-4 flex-1 border border-default"
                />
                </div>
            </div>
        </div>
    </div>
    



      <!-- Buttons -->
      <template #footer>
        <div>
          <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">Back</button>
          <button @click="handleNextClick" class="absolute btn right-[1rem] btn-secondary h-20 w-40">FINISH</button>
        </div>
      </template>

    </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, confirm } from "@45drives/houston-common-ui";
import { ref } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
import { BackUpSetupConfigGlobal } from './BackUpSetupConfigGlobal';
import { useWizardSteps } from '../../components/wizard';

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const backUpTasks = ref<BackUpTask[]>(BackUpSetupConfigGlobal.getInstance().backUpTasks);

const folderInput = ref<HTMLInputElement | null>(null);
const selectedFolders = ref<{ name: string; path: string }[]>([]);

const selectFolder = () => {
  if (folderInput.value) {
    folderInput.value.click(); // Open the hidden input
  }
};


const proceedToNextStep = async () => {
  completeCurrentStep();
};

const proceedToPreviousStep = () => {
  prevStep();
};

const handleNextClick = async () => {
  const proceed = await confirm({
    body: 'Please ensure you save your username and password in a secure location for future reference. You will not be able to retrieve them later. If you have already saved them, click "OK" to proceed. Otherwise, click "Back" to cancel and securely store your credentials.',
    header: "Save Your Credentials",
    confirmButtonText: "OK, Proceed",
    cancelButtonText: "Back"
  }).unwrapOr(false);

  if (proceed) {
    proceedToNextStep();
  }
};
</script>
