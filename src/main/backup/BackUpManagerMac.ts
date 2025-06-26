import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync } from "child_process";
import * as path from "path";
import * as os from "os";
import * as plist from "plist";
import crypto from "crypto";
import { getRsync } from "../utils";
import { checkBackupTaskStatus } from "./CheckSmbStatus";

/**
 * BackUpManager implementation for **macOS** (user‑domain / no sudo prompts)
 * -----------------------------------------------------------------------
 *  • Jobs live in ~/Library/LaunchAgents → the logged‑in user can freely
 *    create / remove / run them without authentication dialogs.
 *  • Task objects mirror the Linux structure (`host`, `share`, `status`, …)
 *    so the UI can treat both platforms identically.
 */
export class BackUpManagerMac implements BackUpManager {
  /** ~/Library/LaunchAgents */
  protected launchdDirectory = path.join(os.homedir(), "Library", "LaunchAgents");
  protected logDirectory = path.join(os.homedir(), ".local", "share", "houston-logs");

  /** launchctl domain for current user (GUI session) */
  private launchctlDomain: string = (() => {
    // On macOS, process.getuid() exists; guard against undefined in other environments
    const uid = typeof process.getuid === "function" ? process.getuid()! : 0;
    return `gui/${uid}`;
  })();

  /* ------------------------------------------------------------------ */
  /*                            PUBLIC API                              */
  /* ------------------------------------------------------------------ */

  /**
   * Discover every Houston backup LaunchAgent and reconstruct a BackUpTask.
   * Performs an async SMB availability check to populate `status`.
   */
  async queryTasks(): Promise<BackUpTask[]> {
    if (!fs.existsSync(this.launchdDirectory)) return [];

    const agentFiles = fs
      .readdirSync(this.launchdDirectory)
      .filter((f) => f.startsWith("com.backup-task") && f.endsWith(".plist"));

    const tasks: BackUpTask[] = [];

    for (const file of agentFiles) {
      const task = this.launchdToBackupTask(file);
      if (!task) continue;

      /* 🔍 Status check mirrors Linux behaviour */
      try {
        task.status = await checkBackupTaskStatus(task);
      } catch (err) {
        console.warn(`Failed to check status for task ${task.uuid}:`, err);
        task.status = "offline_connection_error";
      }

      tasks.push(task);
    }

    return tasks;
  }

  async schedule(
    task: BackUpTask
  ): Promise<{ stdout: string; stderr: string }> {
    fs.mkdirSync(this.launchdDirectory, { recursive: true });
    fs.mkdirSync(this.logDirectory, { recursive: true });
    

    const plistString = this.backupTaskToPlist(task);
    const plistFilename = `com.backup-task.${this.safeTaskName(task.description)}.plist`;
    const plistPath = path.join(this.launchdDirectory, plistFilename);

    fs.writeFileSync(plistPath, plistString, "utf-8");
    this.loadPlist(plistPath);

    return { stdout: "", stderr: "" };
  }

  async scheduleAllTasks(
    tasks: BackUpTask[],
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    fs.mkdirSync(this.launchdDirectory, { recursive: true });
    fs.mkdirSync(this.logDirectory, { recursive: true });

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const plistFilename = `com.backup-task.${this.safeTaskName(t.description)}.plist`;
      const plistPath = path.join(this.launchdDirectory, plistFilename);
      fs.writeFileSync(plistPath, this.backupTaskToPlist(t), "utf-8");
      this.loadPlist(plistPath);
      if (onProgress) onProgress(i + 1, tasks.length, `Installed ${plistFilename}`);
    }
  }

  async runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const label = `com.backup-task.${this.safeTaskName(task.description)}`;
    execSync(`launchctl kickstart -k ${this.launchctlDomain}/${label}`);
    return { stdout: "", stderr: "" };
  }

  async unschedule(task: BackUpTask): Promise<void> {
    const plistFilename = `com.backup-task.${this.safeTaskName(task.description)}.plist`;
    const plistPath = path.join(this.launchdDirectory, plistFilename);
    if (!fs.existsSync(plistPath)) return;

    this.unloadPlist(plistPath);
    fs.rmSync(plistPath);
  }

  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    for (const t of tasks) {
      const plistFilename = `com.backup-task.${this.safeTaskName(t.description)}.plist`;
      const plistPath = path.join(this.launchdDirectory, plistFilename);
      if (!fs.existsSync(plistPath)) continue;
      this.unloadPlist(plistPath);
      fs.rmSync(plistPath);
    }
  }

  async updateSchedule(task: BackUpTask): Promise<void> {
    await this.unschedule(task);
    await this.schedule(task);
  }



  /* ------------------------------------------------------------------ */
  /*                  PRIVATE — launchctl helper wrappers                */
  /* ------------------------------------------------------------------ */

  private loadPlist(plistPath: string) {
    execSync(`plutil -lint "${plistPath}"`); // syntax check
    execSync(`launchctl bootstrap ${this.launchctlDomain} "${plistPath}"`);
  }

  private unloadPlist(plistPath: string) {
    try {
      execSync(`launchctl bootout ${this.launchctlDomain} "${plistPath}"`);
    } catch (_) {
      /* ignore if not loaded */
    }
  }

  /* ------------------------------------------------------------------ */
  /*                             XML helpers                            */
  /* ------------------------------------------------------------------ */

  private escapeXml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private safeTaskName(description: string): string {
    return description.replace(/[^a-zA-Z0-9.-]/g, "_");
  }

  private backupTaskToPlist(task: BackUpTask): string {
    const scheduleXml = this.scheduleToLaunchd(task.schedule);
    const label = this.escapeXml(`com.backup-task.${this.safeTaskName(task.description)}`);
    const rsync = this.escapeXml(getRsync());
    const flags = this.escapeXml(`--archive${task.mirror ? ' --delete' : ''}`);
    const src = this.escapeXml(task.source);
    const tgt = this.escapeXml(task.target);
    const outLog = this.escapeXml(path.join(this.logDirectory, `${this.safeTaskName(task.description)}.log`));
    const errLog = this.escapeXml(path.join(this.logDirectory, `${this.safeTaskName(task.description)}.err`));
    const startIso = this.escapeXml(task.schedule.startDate.toISOString());
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${rsync}</string>
    <string>${flags}</string>
    <string>${src}</string>
    <string>${tgt}</string>
  </array>
${scheduleXml}
  <key>StandardOutPath</key>
  <string>${outLog}</string>
  <key>StandardErrorPath</key>
  <string>${errLog}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>START_DATE</key>
    <string>${startIso}</string>
  </dict>
</dict>
</plist>`;
  }

  /** Turn a TaskSchedule → XML fragment accepted by launchd */
  private scheduleToLaunchd(sched: TaskSchedule): string {
    const m = sched.startDate.getMinutes();
    const h = sched.startDate.getHours();
    const d = sched.startDate.getDate();
    const wd = sched.startDate.getDay();

    switch (sched.repeatFrequency) {
      case "hour":
        return `  <key>StartInterval</key>\n  <integer>3600</integer>`;
      case "day":
        return `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Minute</key><integer>${m}</integer>\n    <key>Hour</key><integer>${h}</integer>\n  </dict>`;
      case "week":
        return `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Minute</key><integer>${m}</integer>\n    <key>Hour</key><integer>${h}</integer>\n    <key>Weekday</key><integer>${wd}</integer>\n  </dict>`;
      case "month":
        return `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Minute</key><integer>${m}</integer>\n    <key>Hour</key><integer>${h}</integer>\n    <key>Day</key><integer>${d}</integer>\n  </dict>`;
      default:
        return ``; // manual‑only
    }
  }

  /** Parse a Houston LaunchAgent → BackUpTask (no status, host resolved later) */
  private launchdToBackupTask(fileName: string): BackUpTask | null {
    const plistPath = path.join(this.launchdDirectory, fileName);
    let parsed: any;
    try {
      parsed = plist.parse(fs.readFileSync(plistPath, "utf-8"));
    } catch (err) {
      console.error("Failed to parse plist", plistPath, err);
      return null;
    }

    const args = parsed.ProgramArguments as string[];
    if (!args || args.length < 4) return null;

    const source = args[2];
    const target = args[3];
    const mirror = args.includes("--delete");

    /* host / share extraction mirrors Linux behaviour */
    let host = "";
    let share = "";
    if (target.includes(":")) {
      const [h, rest] = target.split(":");
      host = h;
      share = rest.split("/")[0] || "";
    }

    // reconstruct schedule (best‑effort)
    const schedule: TaskSchedule = {
      repeatFrequency: "day",
      startDate: new Date(),
    };

    if (parsed.StartInterval) {
      schedule.repeatFrequency = "hour";
    } else if (parsed.StartCalendarInterval) {
      const sci = parsed.StartCalendarInterval;
      if (sci.Weekday !== undefined) schedule.repeatFrequency = "week";
      else if (sci.Day !== undefined) schedule.repeatFrequency = "month";
      else schedule.repeatFrequency = "day";

      const minute = sci.Minute ?? 0;
      const hour = sci.Hour ?? 0;
      const day = sci.Day ?? 1;
      const weekday = sci.Weekday ?? 0;

      schedule.startDate = new Date();
      schedule.startDate.setMinutes(minute);
      schedule.startDate.setHours(hour);
      if (sci.Day !== undefined) schedule.startDate.setDate(day);
      if (sci.Weekday !== undefined) schedule.startDate.setDate(
        schedule.startDate.getDate() + ((7 + weekday - schedule.startDate.getDay()) % 7)
      );
    }

    return {
      uuid: crypto.randomUUID(),
      description: fileName.replace("com.backup-task.", "").replace(".plist", ""),
      schedule,
      source,
      target,
      host,
      share,
      mirror,
      status: "checking",
    };
  }
}
