import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import { spawnSync } from "child_process";

const TASK_ID = "HoustonBackUp";

export class BackUpManagerWin implements BackUpManager {

  queryTasks(): BackUpTask[] {
    const command = 'powershell';
    const args = [
      '-Command',
      `Get-ScheduledTask | Where-Object {$_.TaskName -like '*${TASK_ID}*'} | Select-Object TaskName, Triggers, Actions, State | ConvertTo-Json -depth 10`
    ];

    const argsShort = [
      '-Command',
      `Get-ScheduledTask | Where-Object {$_.TaskName -like '*${TASK_ID}*'} | Select-Object TaskName, Triggers, Actions, State | ConvertTo-Json`
    ];


    // Use spawnSync to run the command synchronously
    const result = spawnSync(command, args);
    const resultShort = spawnSync(command, argsShort);

    if (result.error) {
      console.error('Error executing command:', result.error);
      return [];
    }


    if (resultShort.error) {
      console.error('Error executing command:', result.error);
      return [];
    }

    try {
      const tasks = JSON.parse(result.stdout.toString());
      const tasksShort = JSON.parse(resultShort.stdout.toString());
      const tasksAsArray = Array.isArray(tasks) ? tasks : [tasks];

      return tasksAsArray.map(task => {
        const actionProps = task.Actions[0].CimInstanceProperties;
        let command: string | null = null;
        for (let i = 0; i < actionProps.length; i++) {
          const prop = actionProps[i];
          if (prop.Name === 'Arguments') {
            command = prop.Value;
            break;
          }
        }
        if (!command) {
          console.log("No Command:", actionProps)
          return null;
        }
        const actionDetails = this.parseRobocopyCommand(command)
        if (!actionDetails) {
          console.log("task.Actions:", task.Actions)
          console.log("Failed to parse action details:", actionProps)
          return null;
        }
        const trigger = this.convertTriggersToTaskSchedule(tasksShort.Triggers);

        if (!trigger) {
          console.log("Failed to parse Trigger:", tasksShort.Triggers);
          return null;
        }

        return {
          description: task.TaskName as string,
          schedule: trigger,
          source: actionDetails.source,
          target: actionDetails.target,
          mirror: actionDetails.mirror
        };
      }).filter(task => task !== null) as BackUpTask[];

    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      console.error('String value was:', result.stdout.toString());
      return [];
    }

  }

  schedule(task: BackUpTask): void {

    // PowerShell script to create the task
    const powershellScript = `
$sourcePath = "${task.source}"
$destinationPath = "${task.target}"
$mirror = ${task.mirror ? "true" : "false"}  # Set to $true if you want to mirror the directories

# Determine the robocopy command based on mirror flag
if ($mirror) {
    $robocopyCommand = "robocopy $sourcePath $destinationPath /MIR /Z /XA:H /R:3 /W:5"
} else {
    $robocopyCommand = "robocopy $sourcePath $destinationPath /Z /XA:H /R:3 /W:5"
}

# Create task trigger to run immediately and daily
$taskTrigger = ${this.scheduleToTaskTrigger(task.schedule)}

# Create the robocopy action
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/C $robocopyCommand"

# Register the scheduled task
Register-ScheduledTask -Action $action -Trigger $taskTrigger -TaskName "${TASK_ID}_${task.source}_${task.target}" 
`;

    // Run PowerShell command with spawnSync
    const result = spawnSync('powershell', ['-Command', powershellScript]);

    // Check if the process ran successfully
    if (result.error) {
      console.error(`Error executing PowerShell script: ${result.error.message}`);
    } else {
      console.log('Backup task scheduled successfully.');
      console.log(`Standard Output: ${result.stdout.toString()}`);
      console.log(`Standard Error: ${result.stderr.toString()}`);
    }
  }

  unschedule(task: BackUpTask): void {
    const powershellScript = `
Unregister-ScheduledTask -TaskName "${task.description}" -Confirm:$false
`;

    // Run PowerShell command with spawnSync
    const result = spawnSync('powershell', ['-Command', powershellScript]);

    // Check if the process ran successfully
    if (result.error) {
      console.error(`Error executing PowerShell script: ${result.error.message}`);
    } else {
      console.log(`Task "${task.description}" removed successfully.`);
      console.log(`Standard Output: ${result.stdout.toString()}`);
      console.log(`Standard Error: ${result.stderr.toString()}`);
    }
  }

  protected scheduleToTaskTrigger(sched: TaskSchedule): string {

    console.log(sched);

    const startDate = sched.startDate.toISOString().replace('T', ' ').split('.')[0]; // e.g., "2025-02-25 10:00:00"

    switch (sched.repeatFrequency) {
      case "hour":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily
$taskTrigger.RepetitionInterval = (New-TimeSpan -Hours 1)
`;
      case "day":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily
$taskTrigger.RepetitionInterval = (New-TimeSpan -Days 1)
`;
      case "week":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Weekly
$taskTrigger.RepetitionInterval = (New-TimeSpan -Weeks 1)
`;
      case "month":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Monthly
$taskTrigger.RepetitionInterval = (New-TimeSpan -Months 1)
`;
    }
  }

  protected convertTriggersToTaskSchedule(triggers: any[]): TaskSchedule | null {
    const triggersArray = triggers.map(trigger => {
      // Get the CimInstanceProperties string
      const cimProperties = trigger.CimInstanceProperties;

      // Use regular expressions to extract the relevant properties
      const startBoundaryMatch = cimProperties.match(/StartBoundary\s*=\s*"([^"]+)"/);
      const hoursIntervalMatch = cimProperties.match(/HoursInterval\s*=\s*(\d+)/);
      const daysIntervalMatch = cimProperties.match(/DaysInterval\s*=\s*(\d+)/);
      const weeksIntervalMatch = cimProperties.match(/WeeksInterval\s*=\s*(\d+)/);
      const monthsIntervalMatch = cimProperties.match(/MonthsInterval\s*=\s*(\d+)/);

      // Check if the matches were found and extract values
      if (startBoundaryMatch) {
        if (hoursIntervalMatch) {

          return {
            repeatFrequency: 'hour',
            startDate: new Date(startBoundaryMatch[1]),
          };

        } else if (daysIntervalMatch) {

          return {
            repeatFrequency: 'day',
            startDate: new Date(startBoundaryMatch[1]),
          };

        } else if (weeksIntervalMatch) {

          return {
            repeatFrequency: 'week',
            startDate: new Date(startBoundaryMatch[1]),
          };

        } else if (monthsIntervalMatch) {

          return {
            repeatFrequency: 'month',
            startDate: new Date(startBoundaryMatch[1]),
          };

        } else {
          // Assuming it is done hourly. Based on testing.
          return {
            repeatFrequency: 'hour',
            startDate: new Date(startBoundaryMatch[1]),
          };
        }
      }
      return null;
    }).filter(trigger => trigger !== null);

    if (triggersArray.length !== 1) {
      return null;
    } else {
      return triggersArray[0] as any;
    }
  }

  protected parseRobocopyCommand(command: string): { source: string, target: string, mirror: boolean } | null {
    try {

      command = command.replace("/C robocopy", '').replace(" /Z /XA:H /R:3 /W:5", "").trim();

      console.log(command)

      const regex = /([^\s]+(?:\s[^\s]+)*)\s+([^\s]+(?:\s[^\s]+)*)/;

      // Execute regex on the input command
      const match = command.match(regex);

      if (match) {
        const sourcePath = match[1]?.toString();
        const destinationPath = match[2]?.toString();

        if (!sourcePath || !destinationPath) {
          return null;
        }
        return {
          source: sourcePath,
          target: destinationPath,
          mirror: command.includes("/MIR")
        };
      } else {
        return null;
      }
    } catch (parseError) {
      console.error('Error regex:', parseError);
      console.error('String value was:', command);
      return null;
    }
  }
}
