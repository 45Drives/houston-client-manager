import { BackUpTask, TaskSchedule } from '@45drives/houston-common-lib';

export interface ReviewBackupSetupData {
  tasks: BackUpTask[],
}

export interface EnrichedBackupTask extends BackUpTask {
  type: 'local' | 'remote' | 'remote-cloud'
  
}