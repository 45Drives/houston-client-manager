import { BackUpManager } from "./types";
import { BackUpTask, backupTaskTag, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync } from "child_process";
import { getRsync, getSmbTargetFromSSHTarget, getSSHTargetFromSmbTarget, getOS } from "../utils";

export class BackUpManagerLin implements BackUpManager {
  protected cronFilePath: string = "/etc/cron.d/houston-backup-manager";
  protected pkexec: string = "pkexec";

  queryTasks(): Promise<BackUpTask[]> {
    if (!fs.existsSync(this.cronFilePath)) {
      return new Promise((resolve, _rejest) => {
        resolve([])
      });
    }
    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const tasks = cronEntries.map((cron) => this.cronToBackupTask(cron)).filter(task => task !== null) as BackUpTask[];

    return new Promise((resolve, _rejest) => {
      resolve(tasks)
    });
  }

  schedule(task: BackUpTask, username: string, password: string): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
      const cron = this.backupTaskToCron(task);
      this.ensureCronFile();
      fs.appendFileSync(this.cronFilePath, cron + "\n", "utf-8");
      this.reloadCron();
      resolve({ stdout: "", stderr: "" });
    });
  }

  unschedule(task: BackUpTask): void {
    if (!fs.existsSync(this.cronFilePath)) {
      return;
    }

    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents.split(/[\r\n]+/);

    const newCronEntries = cronEntries.filter((line) => {
      // Only remove lines that match both the tag and description
      return !(line.includes(`# ${backupTaskTag}`) && line.includes(task.description));
    });

    const newCronFileContents = newCronEntries.join("\n") + "\n";

    fs.writeFileSync(this.cronFilePath, newCronFileContents, "utf-8");

    console.log(`🧹 Removed task with description "${task.description}" from cron file`);
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
      default:
        return '';
    }
  }

  protected backupTaskToCron(task: BackUpTask): string {
    console.log('task being converted to cron:', task);
    if (task.source.includes("'")) {
      throw new Error("Source cannot contain ' (single-quote)");
    }
    if (task.target.includes("'")) {
      throw new Error("Target cannot contain ' (single-quote)");
    }
    
    const result = `${this.scheduleToCron(task.schedule)} ${getRsync()}${task.mirror ? " --delete" : ""
      } '${task.source}' 'root@${getSSHTargetFromSmbTarget(task.target)}' # ${backupTaskTag} ${task.description}`;
    console.log('backupTaskToCron Result:', result);
    return result;
  }

  protected cronToBackupTask(cron: string): BackUpTask | null {
    const hourRe = /^(\d+) \* \* \* \*/;
    const dayRe = /^(\d+) (\d+) \* \* \*/;
    const weekRe = /^(\d+) (\d+) \* \* (\d+)/;
    const monthRe = /^(\d+) (\d+) (\d+) \* \*/;

    let schedule: TaskSchedule;
    let match: RegExpExecArray | null;

    if ((match = hourRe.exec(cron))) {
      let [minutes] = match.slice(1).map(Number);
      if (isNaN(minutes)) return null;
      const startDate = new Date();
      startDate.setMinutes(minutes);
      schedule = { repeatFrequency: "hour", startDate };
    } else if ((match = dayRe.exec(cron))) {
      const [minutes, hours] = match.slice(1).map(Number);
      if (isNaN(minutes) || isNaN(hours)) return null;
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      schedule = { repeatFrequency: "day", startDate };
    } else if ((match = weekRe.exec(cron))) {
      const [minutes, hours, weekDay] = match.slice(1).map(Number);
      if (isNaN(minutes) || isNaN(hours) || isNaN(weekDay)) return null;
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      const currentWeekDay = startDate.getDay();
      startDate.setDate(startDate.getDate() + (weekDay - currentWeekDay));
      schedule = { repeatFrequency: "week", startDate };
    } else if ((match = monthRe.exec(cron))) {
      const [minutes, hours, dayOfMonth] = match.slice(1).map(Number);
      if (isNaN(minutes) || isNaN(hours) || isNaN(dayOfMonth)) return null;
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      startDate.setDate(dayOfMonth);
      schedule = { repeatFrequency: "month", startDate };
    } else {
      return null;
    }

    const mirror = cron.includes("--delete");
    const commentMatch = cron.match(/#\s*(.*)$/);
    const description = commentMatch ? commentMatch[1].trim() : "Unnamed Backup";

    // Extract only the last two quoted values for source and target
    const quotedMatches = [...cron.matchAll(/'([^']+)'/g)].map(m => m[1]);
    if (quotedMatches.length < 2) {
      console.warn("❌ Could not extract source/target from cron line:", cron);
      return null;
    }

    const source = quotedMatches[quotedMatches.length - 2];
    const rawTarget = quotedMatches[quotedMatches.length - 1];
    const target = getSmbTargetFromSSHTarget(rawTarget.replace(/^root@/, ''));

    return {
      schedule,
      mirror,
      source,
      target,
      description
    };
  }

  protected reloadCron() {
    const os = getOS();


    let cron = "crond"
    if (os === "debian") {
      cron = "cron"
    }

    execSync(`${this.pkexec} systemctl restart ${cron}`);
  }
}
