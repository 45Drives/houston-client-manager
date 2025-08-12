<template>
    <CardContainer class="overflow-y-auto min-h-0">
        <div class="flex flex-col h-full items-stretch gap-4">
            <p class="w-full text-center text-2xl">Here are your currently scheduled backups. <br />
                Select one or more backup tasks to view, edit, run or cancel.
            </p>

            <div class="overflow-hidden w-full">
                <div class="bg-well p-4 rounded-lg border border-default max-h-[50vh] overflow-y-auto">
                    <BackUpListView ref="backUpListRef" class="p-2" @backUpTaskSelected="handleBackUpTaskSelected" />
                </div>
            </div>
        </div>

        <template #footer>
            <div class="button-group-row w-full justify-end">
                <div class="button-group-row w-full justify-between">
                    <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">Back</button>
                    <!-- <button @click="" class="btn btn-primary w-40 h-20">
                                Restore Files
                            </button> -->
                    <div class="flex flex-wrap gap-3 items-center justify-end mt-2">
                        <button class="btn btn-secondary w-40 h-20 px-5" :disabled="selectedBackUpTasks.length !== 1"
                            @click="viewSelected">View Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' : ''
                            }}</button>
                        <button class="btn btn-primary w-40 h-20 px-5" :disabled="selectedBackUpTasks.length === 0"
                            @click="runSelected">Run Selected Backup NOW{{ selectedBackUpTasks.length > 1 ? 's' : ''
                            }}</button>
                        <button class="btn btn-secondary w-40 h-20 px-5" :disabled="selectedBackUpTasks.length !== 1"
                            @click="editSelected">Edit Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' : ''
                            }}</button>
                        <button class="btn btn-secondary w-40 h-20 px-5" :disabled="selectedBackUpTasks.length !== 1"
                            @click="viewSelectedLog">Check Selected Backup's Logs{{ selectedBackUpTasks.length > 1 ? 's' : ''
                            }}</button>
                        <button class="btn btn-danger w-40 h-20 px-5" :disabled="selectedBackUpTasks.length === 0"
                            @click="deleteSelectedTasks">Cancel Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' :
                            '' }}</button>
                    </div>
                </div>
            </div>
        </template>
    </CardContainer>
</template>

<script setup lang="ts">
import { BackUpTask } from '@45drives/houston-common-lib';
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps, useEnterToAdvance } from '@45drives/houston-common-ui';
import BackUpListView from './BackUpListView.vue';
import { inject, ref } from 'vue';
import { reviewBackUpSetupKey } from '../../keys/injection-keys';
import { useRouter } from 'vue-router';
import { useHeader } from '../../composables/useHeader';
useHeader('Manage Your Backups');

const reviewBackup = inject(reviewBackUpSetupKey);
const router = useRouter();
const selectedBackUpTasks = ref<BackUpTask[]>([]);

const handleBackUpTaskSelected = (tasks: BackUpTask[]) => {
    selectedBackUpTasks.value = tasks;
    if (reviewBackup) reviewBackup.tasks = tasks;
};

const backUpListRef = ref<InstanceType<typeof BackUpListView> | null>(null);

const deleteSelectedTasks = () => {
    backUpListRef.value?.deleteSelectedTasks?.();
};

function runSelected() {
    backUpListRef.value?.runSelectedNow?.();
}

function editSelected() {
    backUpListRef.value?.editSelectedSchedules?.();
}

function viewSelected() {
    // Reuse your wizard flow; this just triggers the same next step action
    proceedToNextStep();
}

function viewSelectedLog() {
    // Reuse your wizard flow; this just triggers the same next step action
    // proceedToNextStep();
    backUpListRef.value?.editSelectedSchedules?.();
}

const { completeCurrentStep, unCompleteCurrentStep } = useWizardSteps('backup');

const proceedToNextStep = async () => {
    if (selectedBackUpTasks.value.length < 1) throw new Error('Select at least one backup task to proceed');
    unCompleteCurrentStep();
    completeCurrentStep(true, selectedBackUpTasks.value);
};

const proceedToPreviousStep = async () => { goBackStep(); };

useEnterToAdvance(() => { }, 300, () => { }, () => { proceedToPreviousStep(); });

const goBackStep = () => { router.push({ name: 'dashboard' }); };
</script>

<style scoped></style>
