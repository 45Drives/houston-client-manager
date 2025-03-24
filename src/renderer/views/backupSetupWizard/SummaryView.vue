<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="flex justify-center text-3xl">Summary</div>
    </template>

    <div class="w-9/12 mx-auto text-center">
      <p class="mb-6 text-2xl">
        You're almost finished! A summary of information can be found below. <br />
        If everything looks accurate, click <span class="font-bold">Next</span> to set up your backups. <br />
        If you'd like to make changes, click <span class="font-bold">Back.</span>
      </p>

      <div class="flex flex-col space-y-4 mt-[5rem]">
        <div class="flex items-center">
          <text class="text-default font-semibold text-left">Back Up Location</text>
          <CommanderToolTip
            :message="`This is the designated backup storage location. It is preconfigured and cannot be modified.`" />
          <text class="text-default font-semibold text-left px-4">{{backUpSetupConfig?.backUpTasks[0].target}}</text>
        </div>
      </div>

      <!-- Folder Selection -->
      <div class="flex flex-col space-y-4 mt-[2rem]">
        <div v-for="(task, index) in backUpSetupConfig?.backUpTasks" :key="index" class="flex items-center">
          <div class="text-start w-[50%]">
            <text class="text-default font-semibold text-left">Folder:</text>

            <text class="text-default font-semibold text-left px-4">{{task.source}}</text>
          </div>
          <div class="text-start w-[50%] flex items-center">
            <text class="text-default font-semibold text-left">When:</text>
            <text v-if="task.schedule.repeatFrequency=='hour'"
              class="text-default font-semibold text-left px-4">{{`Backup will run
              ${formatFrequency(task.schedule.repeatFrequency)} starting on
              ${task.schedule.startDate.toDateString()}`}}</text>

            <!-- <text v-else class="text-default font-semibold text-left px-4">{{`Backup will happen ${formatFrequency(task.schedule.repeatFrequency)} at 9:00 AM starting ${task.schedule.startDate.toDateString()}`}}</text> -->
            <text v-else class="text-default font-semibold text-left px-4">{{ `Backup will happen
              ${formatFrequency(task.schedule.repeatFrequency)} at ${task.schedule.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} starting
              ${task.schedule.startDate.toDateString()}`}}</text>

          </div>
        </div>
      </div>
    </div>




    <!-- Buttons -->
    <template #footer>
      <div>
        <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">Back</button>
        <button @click="handleNextClick" class="absolute btn right-[1rem] btn-secondary h-20 w-40">Next</button>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, confirm } from "@45drives/houston-common-ui";
import { inject, ref } from "vue";
import { useWizardSteps } from '@45drives/houston-common-ui';
import { backUpSetupConfigKey } from "../../keys/injection-keys";

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const backUpSetupConfig = inject(backUpSetupConfigKey);

const proceedToNextStep = async () => {
  completeCurrentStep();
};

const proceedToPreviousStep = () => {
  prevStep();
};

const formatFrequency = (frequency: "hour" | "day" | "week" | "month") => {
    const frequencyMap: Record<string, string> = {
        hour: "hourly",
        day: "daily",
        week: "weekly",
        month: "monthly"
    };
    return frequencyMap[frequency] || frequency; // Default to original if unknown
};

const handleNextClick = async () => {

  proceedToNextStep();
  
};
</script>
