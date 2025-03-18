import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync } from "child_process";
import * as path from "path";

export class BackUpManagerMac implements BackUpManager {
  protected launchdDirectory: string = "/Library/LaunchDaemons";
  protected pkexec: string = "sudo";

  queryTasks(): BackUpTask[] {
    // List files in the LaunchDaemons directory
    const launchdFiles = fs.readdirSync(this.launchdDirectory);
    return launchdFiles
      .filter(file => file.startsWith("com.backup-task"))
      .map(file => this.launchdToBackupTask(file))
      .filter(task => task !== null) as BackUpTask[];
  }

  schedule(task: BackUpTask): void {
    const plist = this.backupTaskToPlist(task);
    this.ensureLaunchdDirectory();
    const plistFilePath = path.join(this.launchdDirectory, `com.backup-task.${task.description}.plist`);
    fs.writeFileSync(plistFilePath, plist, "utf-8");
    this.loadLaunchdJob(plistFilePath);
  }

  unschedule(task: BackUpTask): void {
    const plistFilePath = path.join(this.launchdDirectory, `com.backup-task.${task.description}.plist`);
    if (fs.existsSync(plistFilePath)) {
      fs.unlinkSync(plistFilePath);
      this.unloadLaunchdJob(plistFilePath);
    }
  }

  private ensureLaunchdDirectory(): void {
    if (!fs.existsSync(this.launchdDirectory)) {
      execSync(`${this.pkexec} mkdir -p ${this.launchdDirectory}`);
      execSync(`${this.pkexec} chmod 755 ${this.launchdDirectory}`);
    }
  }

  private backupTaskToPlist(task: BackUpTask): string {
    const schedule = this.scheduleToLaunchd(task.schedule);
    return `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>com.backup-task.${task.description}</string>
        <key>ProgramArguments</key>
        <array>
          <string>rsync</string>
          <string>--archive${task.mirror ? " --delete" : ""}</string>
          <string>'${task.source}'</string>
          <string>'${task.target}'</string>
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
        <string>/tmp/backup-task.${task.description}.log</string>
        <key>StandardErrorPath</key>
        <string>/tmp/backup-task.${task.description}.err</string>
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
        return {
          minute: sched.startDate.getMinutes(),
          hour: sched.startDate.getHours(),
          day: sched.startDate.getDay(),
        };
      case "month":
        return {
          minute: sched.startDate.getMinutes(),
          hour: sched.startDate.getHours(),
          day: sched.startDate.getDate(),
        };
      default:
        return { minute: 0, hour: 0, day: 1 }; // Default to running daily
    }
  }

  private loadLaunchdJob(plistFilePath: string): void {
    execSync(`${this.pkexec} launchctl load ${plistFilePath}`);
  }

  private unloadLaunchdJob(plistFilePath: string): void {
    execSync(`${this.pkexec} launchctl unload ${plistFilePath}`);
  }

  private launchdToBackupTask(fileName: string): BackUpTask | null {
    const plistFilePath = path.join(this.launchdDirectory, fileName);
    const plistContents = fs.readFileSync(plistFilePath, "utf-8");

    // Regex to extract values from plist (simplified for example)
    const match = plistContents.match(/ProgramArguments.*'([^']+)' '([^']+)'/);
    if (!match) {
      return null;
    }

    const source = match[1];
    const target = match[2];

    // Extract schedule data from the plist (you'll need to parse XML for more detailed data)
    const minuteMatch = plistContents.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
    const hourMatch = plistContents.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
    const dayMatch = plistContents.match(/<key>Day<\/key>\s*<integer>(\d+)<\/integer>/);

    const schedule: TaskSchedule = {
      repeatFrequency: "hour", // Default, this should be parsed based on plist
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
