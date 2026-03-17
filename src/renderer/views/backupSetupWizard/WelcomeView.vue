<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <div class="flex flex-col h-full justify-center items-center">
      <p class="w-9/12 text-left text-2xl">
        Your data is precious—protect it with the power of backups! A backup ensures your files are safe from accidents,
        failures, and digital mischief. Set up your protection now and keep your data secure, always.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        We will set up automated backups with your chosen folders and schedule when they should happen. Backup tasks
        will be added to your system so you don't have to worry.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        Choose <b>Simple</b> for our recommended preset schedule, or <b>Custom</b> for full control
        over your backup timing and frequency.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        Anywhere you see this icon: &nbsp;
        <CommanderToolTip :message="`Welcome to the 45Drives Backup Wizard! \n I'm the Houston Commander, and I'm here to show you some tips, tricks and information.
          Click anywhere outside of these popups (or the X in the top-right corner) to close them.`" />
        &nbsp; it means that your new friend Houston Commander has something to say!
        Simply hover your mouse cursor over the icon and you will see him pop up.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        To get started, simply click <b>NEXT</b>
      </p>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button type="button" @click="goBack" class="btn btn-secondary w-40 h-20">
          Back
        </button>
        <button type="button" @click="proceed" class="btn btn-primary w-40 h-20">
          Next
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, useWizardSteps, useEnterToAdvance } from '@45drives/houston-common-ui'
import { CommanderToolTip } from '../../components/commander'
import { useRouter } from 'vue-router'
import { useHeader } from '../../composables/useHeader'

useHeader('Welcome to the 45Drives Backup Wizard!')

const router = useRouter()
const { completeCurrentStep } = useWizardSteps('backup-new')

const proceed = () => {
  completeCurrentStep(true)
}

const goBack = () => {
  router.push({ name: 'backup-manage' })
}

useEnterToAdvance(
  () => { proceed() },
  200,
  () => { proceed() },
  () => { goBack() }
)
</script>
