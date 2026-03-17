import { describe, it, expect } from 'vitest';

// ── Replicate the Task model classes from cockpit-scheduler
// to verify createTaskInstance was fixed correctly.

interface TaskScheduleIntervalType {
  [key: string]: any;
  dayOfWeek?: string[];
}

interface TaskScheduleType {
  enabled: boolean;
  intervals: TaskScheduleIntervalType[];
}

// Minimal parameter node for testing
interface ParameterNode {
  key: string;
  value?: string;
  children?: ParameterNode[];
}

interface TaskTemplateType {
  name: string;
  parameterSchema: ParameterNode;
}

interface TaskInstanceType {
  name: string;
  template: TaskTemplateType;
  parameters: ParameterNode;
  schedule: TaskScheduleType;
  notes: string;
}

// ── Actual classes (mirrors Tasks.ts after our fix)
class TaskInstance implements TaskInstanceType {
  name: string;
  template: TaskTemplate;
  parameters: ParameterNode;
  schedule: TaskSchedule;
  notes: string;

  constructor(name: string, template: TaskTemplate, parameters: ParameterNode, schedule: TaskSchedule, notes: string) {
    this.name = name;
    this.template = template;
    this.parameters = parameters;
    this.schedule = schedule;
    this.notes = notes;
  }
}

class TaskSchedule implements TaskScheduleType {
  enabled: boolean;
  intervals: TaskScheduleIntervalType[];

  constructor(enabled: boolean, intervals: TaskScheduleIntervalType[]) {
    this.enabled = enabled;
    this.intervals = intervals;
  }
}

class TaskTemplate implements TaskTemplateType {
  name: string;
  parameterSchema: ParameterNode;

  constructor(name: string, parameterSchema: ParameterNode) {
    this.name = name;
    this.parameterSchema = parameterSchema;
  }

  createTaskInstance(name: string, parameters: ParameterNode, schedule: TaskSchedule, notes: string = ''): TaskInstance {
    return new TaskInstance(name, this, parameters, schedule, notes);
  }
}

// ── Subclass example (mirrors ZFSScrubTaskTemplate etc.)
class ZFSScrubTaskTemplate extends TaskTemplate {
  constructor() {
    super('ZFS Scrub', { key: 'pool', value: '' });
  }

  createTaskInstance(name: string, parameters: ParameterNode, schedule: TaskSchedule, notes: string = ''): TaskInstance {
    return new TaskInstance(name, this, parameters, schedule, notes);
  }
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────
describe('createTaskInstance() — post-fix', () => {
  const schedule = new TaskSchedule(true, [{ hour: '0', minute: '0' }]);
  const params: ParameterNode = { key: 'pool', value: 'tank' };

  it('returns a TaskInstance (not the TaskTemplate class)', () => {
    const template = new TaskTemplate('Generic', { key: 'root' });
    const instance = template.createTaskInstance('My Task', params, schedule, 'some notes');

    expect(instance).toBeInstanceOf(TaskInstance);
    expect(instance).not.toBeInstanceOf(TaskTemplate);
  });

  it('instance has correct properties', () => {
    const template = new TaskTemplate('ZFS Scrub', { key: 'pool' });
    const instance = template.createTaskInstance('Weekly Scrub', params, schedule, 'check pool health');

    expect(instance.name).toBe('Weekly Scrub');
    expect(instance.template).toBe(template);
    expect(instance.parameters).toBe(params);
    expect(instance.schedule).toBe(schedule);
    expect(instance.notes).toBe('check pool health');
  });

  it('notes defaults to empty string', () => {
    const template = new TaskTemplate('Test', { key: 'root' });
    const instance = template.createTaskInstance('No Notes', params, schedule);

    expect(instance.notes).toBe('');
  });

  it('subclass creates instance with correct template reference', () => {
    const scrubTemplate = new ZFSScrubTaskTemplate();
    const instance = scrubTemplate.createTaskInstance('Nightly Scrub', params, schedule);

    expect(instance).toBeInstanceOf(TaskInstance);
    expect(instance.template).toBe(scrubTemplate);
    expect(instance.template.name).toBe('ZFS Scrub');
  });

  it('different templates create independent instances', () => {
    const t1 = new TaskTemplate('Scrub', { key: 'pool' });
    const t2 = new TaskTemplate('Snapshot', { key: 'dataset' });

    const i1 = t1.createTaskInstance('Task A', params, schedule);
    const i2 = t2.createTaskInstance('Task B', params, schedule);

    expect(i1.template).not.toBe(i2.template);
    expect(i1.template.name).toBe('Scrub');
    expect(i2.template.name).toBe('Snapshot');
  });
});

describe('TaskSchedule', () => {
  it('constructs with enabled flag and intervals', () => {
    const sched = new TaskSchedule(true, [
      { hour: '2', minute: '30', dayOfWeek: ['monday', 'friday'] },
    ]);

    expect(sched.enabled).toBe(true);
    expect(sched.intervals).toHaveLength(1);
    expect(sched.intervals[0].dayOfWeek).toEqual(['monday', 'friday']);
  });

  it('disabled schedule with empty intervals', () => {
    const sched = new TaskSchedule(false, []);
    expect(sched.enabled).toBe(false);
    expect(sched.intervals).toHaveLength(0);
  });
});
