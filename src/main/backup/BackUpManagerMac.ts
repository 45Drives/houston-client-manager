import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync } from "child_process";
import * as path from "path";

export class BackUpManagerMac implements BackUpManager {
  protected launchdDirectory: string = "/Library/LaunchDaemons";

  queryTasks(): BackUpTask[] {
    const launchdFiles = fs.readdirSync(this.launchdDirectory);
    return launchdFiles
      .filter(file => file.startsWith("com.backup-task"))
      .map(file => this.launchdToBackupTask(file))
      .filter(task => task !== null) as BackUpTask[];
  }

  schedule(task: BackUpTask): void {
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

    this.runAsAdmin(command);
  }

  unschedule(task: BackUpTask): void {
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

  private runAsAdmin(command: string): void {
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
          <string>/usr/bin/rsync</string>
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

    const match = plistContents.match(/ProgramArguments.*'([^']+)' '([^']+)'/);
    if (!match) {
      return null;
    }

    const source = match[1];
    const target = match[2];

    const minuteMatch = plistContents.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
    const hourMatch = plistContents.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
    const dayMatch = plistContents.match(/<key>Day<\/key>\s*<integer>(\d+)<\/integer>/);

    const schedule: TaskSchedule = {
      repeatFrequency: "hour",
      startDate: new Date(),
    };

    schedule.startDate.setMinutes(minuteMatch ? parseInt(minuteMatch[1]) : 0);
    schedule.startDate.setHours(hourMatch ? parseInt(hourMatch[1]) : 0);
    schedule.startDate.setDate(dayMatch ? parseInt(dayMatch[1]) : 1);

    return {
      schedule: schedule,
      source,
      target,
      description: fileName.replace("com.backup-task.", "").replace(".plist", ""),
      mirror: plistContents.includes("--delete"),
    };
  }
}
