<template>
    <CardContainer class="overflow-y-auto min-h-0">

        <div class="grid grid-cols-2 gap-10 text-2xl w-9/12 mx-auto">
            <CardContainer class="col-span-1 bg-accent border-default rounded-md">
                <template #header>
                    <button @click="createLocalBackup" class="btn btn-secondary w-full h-40 text-6xl">
                        LOCAL
                    </button>
                </template>
                <div>
                    <p>
                        Select <b>LOCAL</b> to schedule backups from this computer to a 45Drives server on your network.
                    </p>
                </div>

            </CardContainer>

            <CardContainer class="relative col-span-1 bg-accent border-default rounded-md overflow-hidden">


                <template #header>
                    <button @click="createRemoteBackup" class="btn btn-secondary w-full h-40 text-6xl">
                        REMOTE
                    </button>
                </template>

                <div>
                    <p>
                        Select <b>REMOTE</b> to schedule backups from a 45Drives server to either another 45Drives
                        server or to a cloud provider.
                        <CommanderToolTip
                            :message="``" />

                    </p>
                </div>


            </CardContainer>
        </div>

        <template #footer>
            <div class="button-group-row justify-left">
                <button @click="proceedToPreviousStep" class="btn btn-secondary h-20 w-40">Back</button>
            </div>
        </template>
    </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import { useWizardSteps, useEnterToAdvance, WizardState } from '@45drives/houston-common-ui';
import { useHeader } from '../../composables/useHeader'
import { useRouter } from 'vue-router'
const router = useRouter()
useHeader('Choose Backup Type');

const { completeCurrentStep } = useWizardSteps('backup-new');

const createLocalBackup = () => {
    completeCurrentStep(true, { choice: "local" });
};

const createRemoteBackup = () => {
    completeCurrentStep(true, { choice: "remote" });

};

const proceedToPreviousStep = () => {
    router.push({ name: 'backup', query: { step: '1' } });
};

useEnterToAdvance(
    () => { },     // Disable Enter
    0,            // No debounce needed if Enter does nothing
    () => { },     // Disable ArrowRight
    () => {
        proceedToPreviousStep(); // Enable only ArrowLeft
    }
);
</script>
