import { BackUpManager } from "./types";
import { BackUpTask, backupTaskTag, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { writeFileSync, chmodSync } from 'fs';
import { execSync } from "child_process";
import { getOS, getAppPath, getSmbTargetFromSmbTarget, reconstructFullTarget } from "../utils";
import { join } from "path";

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
      const cron = this.backupTaskToCron(task, username, password);
      this.ensureCronFile();
      fs.appendFileSync(this.cronFilePath, cron + "\n", "utf-8");
      this.reloadCron();
      resolve({ stdout: "", stderr: "" });
    });
  }

  unschedule(task: BackUpTask): void {
    if (!fs.existsSync(this.cronFilePath)) return;

    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents.split(/[\r\n]+/);

    let scriptPathToDelete: string | null = null;

    const newCronEntries = cronEntries.filter((line) => {
      const shouldRemove = line.includes(`# ${backupTaskTag}`) && line.includes(task.description);

      // If it's a match, extract the script path for deletion
      if (shouldRemove) {
        const parts = line.split(" ");
        const scriptPath = parts.slice(5).find(p => p.endsWith(".sh"));
        if (scriptPath) {
          scriptPathToDelete = scriptPath;
        }
      }

      return !shouldRemove;
    });

    // Write updated cron file
    fs.writeFileSync(this.cronFilePath, newCronEntries.join("\n") + "\n", "utf-8");
    console.log(`🧹 Removed task with description "${task.description}" from cron file`);

    // Delete the script if it exists
    if (scriptPathToDelete && fs.existsSync(scriptPathToDelete)) {
      try {
        fs.unlinkSync(scriptPathToDelete);
        console.log(`🗑️ Deleted backup script: ${scriptPathToDelete}`);
      } catch (err) {
        console.error(`❌ Failed to delete script at ${scriptPathToDelete}:`, err);
      }
    } else {
      console.warn(`⚠️ Script file not found for deletion: ${scriptPathToDelete}`);
    }
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

  protected backupTaskToCron(task: BackUpTask, smbUser: string, smb_pass: string): string {
    console.log('task being converted to cron:', task);
    if (task.source.includes("'")) {
      throw new Error("Source cannot contain ' (single-quote)");
    }
    if (task.target.includes("'")) {
      throw new Error("Target cannot contain ' (single-quote)");
    }

    console.log("task.target", task.target);

    let targetPath = "/tank/" + task.target.split(":")[1];
    console.log("targetPath", targetPath)

    let [smbHost, smbShare] = task.target.split(":");
    smbShare = smbShare.split("/")[0];

    // Path to save the script
    const scriptName = `run_backup_task${crypto.randomUUID()}.sh`;
    const scriptPath = join(getAppPath(), scriptName);

   /*  const scriptContent = `#!/bin/bash

SMB_HOST='${smbHost}'
SMB_SHARE='${smbShare}'
SMB_USER='${smbUser}'
SMB_PASS='${smb_pass}'
SOURCE='${task.source}'
TARGET='${getSmbTargetFromSmbTarget(task.target)}'

MOUNT_POINT="/mnt/backup_$$"

mkdir -p "$MOUNT_POINT"

mount -t cifs "//$SMB_HOST/$SMB_SHARE" "$MOUNT_POINT" \\
  -o username="$SMB_USER",password="$SMB_PASS",rw,iocharset=utf8

if [ $? -ne 0 ]; then
  echo "Failed to mount //$SMB_HOST$SMB_SHARE"
  exit 1
fi

rsync -a${task.mirror ? ' --delete' : ''} "$SOURCE" "$MOUNT_POINT/$TARGET"

umount "$MOUNT_POINT"
rmdir "$MOUNT_POINT"
`; */
    const scriptContent = `#!/bin/bash
set -e

SMB_HOST='${smbHost}'
SMB_SHARE='${smbShare}'
SMB_USER='${smbUser}'
SMB_PASS='${smb_pass}'
SOURCE='${task.source}'
TARGET='${getSmbTargetFromSmbTarget(task.target)}'

MOUNT_POINT="/mnt/backup_$$"

mkdir -p "$MOUNT_POINT"

mount -t cifs "//$SMB_HOST/$SMB_SHARE" "$MOUNT_POINT" \\
  -o username="$SMB_USER",password="$SMB_PASS",rw,iocharset=utf8

if [ $? -ne 0 ]; then
  echo "Failed to mount //$SMB_HOST/$SMB_SHARE"
  exit 1
fi

# Ensure destination directory exists
mkdir -p "$MOUNT_POINT/$TARGET"

# Perform rsync with optional --delete
rsync -a${task.mirror ? ' --delete' : ''} "$SOURCE" "$MOUNT_POINT/$TARGET"

umount "$MOUNT_POINT"
rmdir "$MOUNT_POINT"
`;


    writeFileSync(scriptPath, scriptContent, { mode: 0o700 });
    chmodSync(scriptPath, 0o700); // Make sure it’s executable

    const cronEntry = `${this.scheduleToCron(task.schedule)} ${scriptPath} # ${backupTaskTag} ${task.description}`;
    console.log('backupTaskToCron Result:', cronEntry);

    return cronEntry;
  }

  protected cronToBackupTask(cron: string): BackUpTask | null {
    // console.log('cronToBackupTask Called');
    const hourRe = /^(\d+) \* \* \* \*/;
    const dayRe = /^(\d+) (\d+) \* \* \*/;
    const weekRe = /^(\d+) (\d+) \* \* (\d+)/;
    const monthRe = /^(\d+) (\d+) (\d+) \* \*/;

    let schedule: TaskSchedule;
    let match: RegExpExecArray | null;

    if ((match = hourRe.exec(cron))) {
      const [minutes] = match.slice(1).map(Number);
      const startDate = new Date();
      startDate.setMinutes(minutes);
      schedule = { repeatFrequency: "hour", startDate };
    } else if ((match = dayRe.exec(cron))) {
      const [minutes, hours] = match.slice(1).map(Number);
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      schedule = { repeatFrequency: "day", startDate };
    } else if ((match = weekRe.exec(cron))) {
      const [minutes, hours, weekDay] = match.slice(1).map(Number);
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      const currentWeekDay = startDate.getDay();
      startDate.setDate(startDate.getDate() + (weekDay - currentWeekDay));
      schedule = { repeatFrequency: "week", startDate };
    } else if ((match = monthRe.exec(cron))) {
      const [minutes, hours, dayOfMonth] = match.slice(1).map(Number);
      const startDate = new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      startDate.setDate(dayOfMonth);
      schedule = { repeatFrequency: "month", startDate };
    } else {
      return null;
    }

    const commentMatch = cron.match(/#\s*(.*)$/);
    const description = commentMatch ? commentMatch[1].trim() : "Unnamed Backup";

    // 🔍 Extract script path from cron line
    const parts = cron.split(" ");
    const scriptPath = parts.slice(5).find(p => p.endsWith(".sh"));
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      console.warn("❌ Script file not found:", scriptPath);
      return null;
    }

    const scriptContent = fs.readFileSync(scriptPath, "utf-8");

    const sourceMatch = scriptContent.match(/SOURCE='([^']+)'/);
    const targetMatch = scriptContent.match(/TARGET='([^']+)'/);

    if (!sourceMatch || !targetMatch) {
      console.warn("❌ Could not extract SOURCE or TARGET from script:", scriptPath);
      return null;
    }

    const source = sourceMatch[1];
    // console.log('source:', source);
    const rawTarget = targetMatch[1];
    // console.log('rawTarget:', rawTarget);
    // const target = getSmbTargetFromSSHTarget(rawTarget.replace(/^root@/, ''));
    const target = reconstructFullTarget(scriptPath);
    // console.log('target:', target)

    const mirror = scriptContent.includes("--delete");

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
