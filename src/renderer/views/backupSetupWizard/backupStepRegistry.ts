import type { WizardStep } from '@45drives/houston-common-ui'

import WelcomeView from './WelcomeView.vue'
import ChooseDifficultyView from './ChooseDifficultyView.vue'
import EnterSmbCredBackUpSetupView from './EnterSmbCredBackUpSetupView.vue'
import SummaryView from './SummaryView.vue'
import CompleteBackUpCreationView from './CompleteBackUpCreationView.vue'

// branch-specific implementations
import CreateSimpleLocal from './CreateSimpleBackupView.vue'
import CustomizeLocal from './CustomizeBackupView.vue'
import CreateSimpleRemote from './CreateSimpleRemoteBackupView.vue' // NEW
import CustomizeRemote from './CustomizeRemoteBackupView.vue'       // NEW

export type BackupMode = 'local'|'remote'
export type BackupStyle = 'simple'|'custom'

export function buildBackupSteps(mode: BackupMode, style: BackupStyle): WizardStep[] {
  const intro: WizardStep[] = [
    { label: 'Welcome', component: WelcomeView },
    { label: 'Setup Option', component: ChooseDifficultyView,
      nextStep: (d:any) => (d.choice === 'simple' ? 2 : 3) },
  ]

  const branch: WizardStep[] = style === 'simple'
    ? [{ label: 'Create Simple Backup',
         component: mode === 'local' ? CreateSimpleLocal : CreateSimpleRemote,
         nextStep: () => 4 }]
    : [{ label: 'Create Custom Backup',
         component: mode === 'local' ? CustomizeLocal : CustomizeRemote,
         nextStep: () => 4 }]

  const tail: WizardStep[] = [
    { label: 'Credentials', component: EnterSmbCredBackUpSetupView },
    { label: 'Summary', component: SummaryView },
    { label: 'Complete', component: CompleteBackUpCreationView },
  ]

  return [...intro, ...branch, ...tail]
}
