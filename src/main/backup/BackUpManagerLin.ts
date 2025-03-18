import { BackUpManager } from "./types";
import { BackUpTask, backupTaskTag, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync } from "child_process";
import { getRsync, getSmbTargetFromSSHTarget, getSSHTargetFromSmbTarget } from "../utils";

export class BackUpManagerLin implements BackUpManager {
  protected cronFilePath: string = "/etc/cron.d/houston-backup-manager";
  protected pkexec: string = "pkexec";

  queryTasks(): BackUpTask[] {
    if (!fs.existsSync(this.cronFilePath)) {
      return [];
    }
    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents.split(/[\r\n]+/);
    return cronEntries.map((cron) => this.cronToBackupTask(cron)).filter(task => task !== null) as BackUpTask[];
  }

  schedule(task: BackUpTask) {
    const cron = this.backupTaskToCron(task);
    this.ensureCronFile();
    fs.appendFileSync(this.cronFilePath, cron + "\n", "utf-8");
    this.reloadCron();
  }

  unschedule(task: BackUpTask): void {
    if (!fs.existsSync(this.cronFilePath)) {
      return;
    }
    const cron = this.backupTaskToCron(task);
    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents.split(/[\r\n]+/);
    const newCronEntries = cronEntries.filter((c) => c !== cron);
    const newCronFileContents = newCronEntries.join("\n") + "\n";
    fs.writeFileSync(this.cronFilePath, newCronFileContents, "utf-8");
    this.reloadCron();
  }

  private ensureCronFile(): void {
    if (!fs.existsSync(this.cronFilePath)) {
      execSync(
        `${this.pkexec} bash -c 'touch ${this.cronFilePath} && chmod a+rw ${this.cronFilePath}'`
      );
    }
  }

  protected scheduleToCron(sched: TaskSchedule): string {
    switch (sched.repeatFrequency) {
      case "hour":
        return `${sched.startDate.getMinutes()} * * * *`;
      case "day":
        return `${sched.startDate.getMinutes()} ${sched.startDate.getHours()} * * *`;
      case "week":
        return `${sched.startDate.getMinutes()} ${sched.startDate.getHours()} * * ${sched.startDate.getDay()}`;
      case "month":
        return `${sched.startDate.getMinutes()} ${sched.startDate.getHours()} ${sched.startDate.getDate()} * *`;
    }
  }

  protected backupTaskToCron(task: BackUpTask): string {
    if (task.source.includes("'")) {
      throw new Error("Source cannot contain ' (single-quote)");
    }
    if (task.target.includes("'")) {
      throw new Error("Target cannot contain ' (single-quote)");
    }
    ;
    return `${this.scheduleToCron(task.schedule)} ${getRsync()}${task.mirror ? " --delete" : ""
      } '${task.source}' 'root@${getSSHTargetFromSmbTarget(task.target)}' # ${backupTaskTag} ${task.description}`;
  }

  protected cronToBackupTask(cron: string): BackUpTask | null {
    const hourRe = /^(\d+) \* \* \* \*/;
    const dayRe = /^(\d+) (\d+) \* \* \*/;
    const weekRe = /^(\d+) (\d+) \* \* (\d+)/;
    const monthRe = /^(\d+) (\d+) (\d+) \* \*/;

    let schedule: TaskSchedule;

    let match: RegExpExecArray | null;
    if ((match = hourRe.exec(cron))) {
      let [minutes] = match.slice(1).map((numStr) => parseInt(numStr));

      if (!minutes) {
        return null;
      }
      const startDate = new Date();
      startDate.setMinutes(minutes);
      schedule = {
        repeatFrequency: "hour",
        startDate,
      };
    } else if ((match = dayRe.exec(cron))) {
      const [minutes, hours] = match.slice(1).map((numStr) => parseInt(numStr));
      if (!minutes || !hours) {
        return null;
      }
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      schedule = {
        repeatFrequency: "day",
        startDate,
      };
    } else if ((match = weekRe.exec(cron))) {
      const [minutes, hours, weekDay] = match
        .slice(1)
        .map((numStr) => parseInt(numStr));

      if (!minutes || !hours || !weekDay) {
        return null;
      }

      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      const currentWeekDay = startDate.getDay();
      startDate.setDate(startDate.getDate() + (weekDay - currentWeekDay));
      schedule = {
        repeatFrequency: "week",
        startDate,
      };
    } else if ((match = monthRe.exec(cron))) {
      const [minutes, hours, dayOfMonth] = match
        .slice(1)
        .map((numStr) => parseInt(numStr));

      if (!minutes || !hours || !dayOfMonth) {
        return null;
      }

      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      startDate.setDate(dayOfMonth);
      schedule = {
        repeatFrequency: "month",
        startDate,
      };
    } else {
      throw new Error("Invalid cron format: " + cron);
    }

    const mirror = cron.includes("--delete");
    const description = cron.split("#")[1].trim();

    cron = cron.split("#")[0];
    cron = cron.replace("/C " + getRsync(), '').replace("--delete", "").replace("root@", "").trim();

    const regex = /([^\s]+(?:\s[^\s]+)*)\s+([^\s]+(?:\s[^\s]+)*)/;

    // Execute regex on the input command
    const matchSourceTarget = cron.match(regex);

    if (matchSourceTarget) {
      const sourcePath = match[1]?.toString();
      const destinationPath = getSmbTargetFromSSHTarget(match[2]?.toString());
      if (!sourcePath || !destinationPath) {
        return null;
      }

      return {
        schedule: schedule,
        mirror: mirror,
        source: sourcePath,
        target: destinationPath,
        description
      };
    } else {
      return null;
    }
  }

  protected reloadCron() {
    execSync(`${this.pkexec} systemctl restart crond`);
  }
}
