import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync } from "child_process";
import * as path from "path";
import * as plist from 'plist';
import { getRsync } from "../utils";

export class BackUpManagerMac implements BackUpManager {
  protected launchdDirectory: string = "/Library/LaunchDaemons";

  queryTasks(): Promise<BackUpTask[]> {
    const launchdFiles = fs.readdirSync(this.launchdDirectory);
    const tasks = launchdFiles
      .filter(file => file.startsWith("com.backup-task"))
      .map(file => this.launchdToBackupTask(file))
      .filter(task => task !== null) as BackUpTask[];

    return new Promise((resolve, _rejest) => {
      resolve(tasks)
    });
  }

  schedule(task: BackUpTask, username: string, password: string): Promise<{ stdout: string, stderr: string }> {
    const plist = this.backupTaskToPlist(task);
    const plistFileName = `com.backup-task.${this.safeTaskName(task.description)}.plist`;
    const tempPlistPath = path.join("/tmp", plistFileName);
    const launchdPlistPath = path.join(this.launchdDirectory, plistFileName);

    // Write to a temp file first
    fs.writeFileSync(tempPlistPath, plist, "utf-8");

    const command = [
      `mkdir -p "${this.launchdDirectory}"`,
      `chmod 755 "${this.launchdDirectory}"`,
      `cp "${tempPlistPath}" "${launchdPlistPath}"`,
      `chmod 644 "${launchdPlistPath}"`,
      `chown root:wheel "${launchdPlistPath}"`,
      `launchctl load "${launchdPlistPath}"`
    ].join(" && ");

    return new Promise((resolve, reject) => {
      this.runAsAdmin(command)
      resolve({ stdout: "", stderr: "" });
    });
  }

  async scheduleAllTasks(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      await this.schedule(task, username, password);
      if (onProgress) {
        onProgress(i + 1, tasks.length, `Scheduled task for ${task.description}`);
      }
    }
  }
  
  runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const label = `com.backup-task.${this.safeTaskName(task.description)}`;
    const command = `launchctl kickstart -k system/${label}`;

    return new Promise((resolve, reject) => {
      try {
        this.runAsAdmin(command, `Running backup task: ${label}`);
        resolve({ stdout: "", stderr: "" });
      } catch (error: any) {
        reject(error);
      }
    });
  }

  async unschedule(task: BackUpTask): Promise<void> {
    const plistFileName = `com.backup-task.${this.safeTaskName(task.description)}.plist`;
    const plistFilePath = path.join(this.launchdDirectory, plistFileName);

    if (fs.existsSync(plistFilePath)) {
      const command = [
        `launchctl unload "${plistFilePath}"`,
        `rm -f "${plistFilePath}"`
      ].join(" && ");

      this.runAsAdmin(command);
    }
  }

  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    const unloadCommands: string[] = [];

    for (const task of tasks) {
      const plistFileName = `com.backup-task.${this.safeTaskName(task.description)}.plist`;
      const plistFilePath = path.join(this.launchdDirectory, plistFileName);

      if (fs.existsSync(plistFilePath)) {
        unloadCommands.push(`launchctl unload "${plistFilePath}"`);
        unloadCommands.push(`rm -f "${plistFilePath}"`);
      } else {
        console.warn(`⚠️ Task plist not found: ${plistFilePath}`);
      }
    }

    if (unloadCommands.length === 0) return;

    const combinedCommand = unloadCommands.join(" && ");
    this.runAsAdmin(combinedCommand, "Removing selected backup tasks...");
  }
  

  async updateSchedule(task: BackUpTask): Promise<void> {
    console.warn("🚧 updateSchedule is not yet implemented for macOS.");
    throw new Error("Backup scheduling update is not supported on macOS yet.");
  }

  private runAsAdmin(command: string, message: string = "This 45Drives Setup Wizard requires administrator privileges."): void {
    execSync(`osascript -e 'display dialog "${message.replace(/"/g, '\\"')}" with title "Backup Scheduler" buttons {"OK"} default button 1'`);
    execSync(`osascript -e 'do shell script "${this.escapeForAppleScript(command)}" with administrator privileges'`);
  }

  private escapeForAppleScript(cmd: string): string {
    return cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private safeTaskName(description: string): string {
    return description.replace(/[^a-zA-Z0-9.-]/g, "_");
  }

  private backupTaskToPlist(task: BackUpTask): string {
    const schedule = this.scheduleToLaunchd(task.schedule);
    return `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>com.backup-task.${this.safeTaskName(task.description)}</string>
        <key>ProgramArguments</key>
        <array>
          <string>${getRsync()}</string>
          <string>--archive${task.mirror ? " --delete" : ""}</string>
          <string>${task.source}</string>
          <string>${task.target}</string>
        </array>
        <key>StartCalendarInterval</key>
        <dict>
          <key>Minute</key>
          <integer>${schedule.minute}</integer>
          <key>Hour</key>
          <integer>${schedule.hour}</integer>
          <key>Day</key>
          <integer>${schedule.day}</integer>
        </dict>
        <key>StandardOutPath</key>
        <string>/var/log/${this.safeTaskName(task.description)}.log</string>
        <key>StandardErrorPath</key>
        <string>/var/log/${this.safeTaskName(task.description)}.err</string>
        <key>RunAtLoad</key>
        <true/>
      </dict>
    </plist>`;
  }

  private scheduleToLaunchd(sched: TaskSchedule): { minute: string | number; hour: string | number; day: string | number } {
    switch (sched.repeatFrequency) {
      case "hour":
        return { minute: sched.startDate.getMinutes(), hour: "*", day: "*" };
      case "day":
        return { minute: sched.startDate.getMinutes(), hour: sched.startDate.getHours(), day: "*" };
      case "week":
        return { minute: sched.startDate.getMinutes(), hour: sched.startDate.getHours(), day: sched.startDate.getDay() };
      case "month":
        return { minute: sched.startDate.getMinutes(), hour: sched.startDate.getHours(), day: sched.startDate.getDate() };
      default:
        return { minute: 0, hour: 0, day: 1 };
    }
  }

  private launchdToBackupTask(fileName: string): BackUpTask | null {
    const plistFilePath = path.join(this.launchdDirectory, fileName);
    const plistContents = fs.readFileSync(plistFilePath, "utf-8");

    let parsedPlist;
    try {
      parsedPlist = plist.parse(plistContents);
    } catch (error) {
      console.error(`Failed to parse plist: ${fileName}`, error);
      return null;
    }

    // Extract ProgramArguments (source and target paths)
    const programArguments = parsedPlist['ProgramArguments'];
    if (!programArguments || programArguments.length < 4) {
      console.error('ProgramArguments not found or malformed in plist');
      return null;
    }

    const source = programArguments[2]; // The third element in the array is the source path
    const target = programArguments[3]; // The fourth element in the array is the target path

    // Extract schedule information from StartCalendarInterval
    const schedule = parsedPlist['StartCalendarInterval'] || {};
    const minute = schedule['Minute'] || 0;
    const hour = schedule['Hour'] || 0;
    const day = schedule['Day'] || 1; // Default to 1st day of the month

    const taskSchedule: TaskSchedule = {
      repeatFrequency: "hour", // Default, adjust based on more complex logic if needed
      startDate: new Date(),
    };

    taskSchedule.startDate.setMinutes(minute);
    taskSchedule.startDate.setHours(hour);
    taskSchedule.startDate.setDate(day);

    return {
      schedule: taskSchedule,
      source,
      target,
      description: fileName.replace("com.backup-task.", "").replace(".plist", ""),
      mirror: plistContents.includes("--delete"),
      uuid: crypto.randomUUID()
    };
  }
}
