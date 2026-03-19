import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../src/utils/logger.js';
import { validateResponse } from '../src/utils/response-validator.js';
import { eventBus } from '../src/events/event-bus.js';
import { remodulerState } from '../src/state/remoduler-state.js';
import { CheckpointManager } from '../src/state/checkpoint-manager.js';
import { config, validateConfig } from '../src/config.js';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// --- [1.2] Logger ---
describe('logger', () => {
  it('has all required methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.success).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.taskHeader).toBe('function');
  });

  it('does not throw', () => {
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.info('test', 'PLANNER')).not.toThrow();
    expect(() => logger.success('ok', 'CODER')).not.toThrow();
    expect(() => logger.warn('warn')).not.toThrow();
    expect(() => logger.error('err', 'REVIEWER')).not.toThrow();
    expect(() => logger.taskHeader('My Task')).not.toThrow();
  });
});

// --- [1.4] Response Validator ---
describe('validateResponse', () => {
  it('passes with all required fields', () => {
    const r = validateResponse({ taskId: '1', title: 'x' }, ['taskId', 'title']);
    expect(r.valid).toBe(true);
  });

  it('fails with missing fields', () => {
    const r = validateResponse({ taskId: '1' }, ['taskId', 'title']);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Missing required field: title');
  });

  it('fails on non-object', () => {
    expect(validateResponse(null, ['a']).valid).toBe(false);
    expect(validateResponse('str', ['a']).valid).toBe(false);
  });
});

// --- [1.5] EventBus ---
describe('eventBus', () => {
  beforeEach(() => eventBus.clear());

  it('emits and receives events', () => {
    const fn = vi.fn();
    eventBus.on('test', fn);
    eventBus.emit('test', { x: 1 });
    expect(fn).toHaveBeenCalledWith({ x: 1 });
  });

  it('unsubscribes', () => {
    const fn = vi.fn();
    const unsub = eventBus.on('test', fn);
    unsub();
    eventBus.emit('test', {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('handles errors in listeners without breaking', () => {
    eventBus.on('bad', () => { throw new Error('boom'); });
    const fn = vi.fn();
    eventBus.on('bad', fn);
    eventBus.emit('bad', {});
    expect(fn).toHaveBeenCalled(); // second listener still runs
  });
});

// --- [1.6] RemodulerState ---
describe('remodulerState', () => {
  beforeEach(() => remodulerState.reset());

  it('starts idle', () => {
    expect(remodulerState.state.execution).toBe('idle');
  });

  it('tracks execution state', () => {
    remodulerState.setExecution('running');
    expect(remodulerState.state.execution).toBe('running');
    expect(remodulerState.state.startedAt).toBeGreaterThan(0);
  });

  it('tracks task completion and cost', () => {
    remodulerState.taskCompleted(0.05);
    remodulerState.taskCompleted(0.10);
    expect(remodulerState.state.tasksCompleted).toBe(2);
    expect(remodulerState.state.totalCost).toBeCloseTo(0.15);
  });

  it('tracks failures', () => {
    remodulerState.taskFailed('timeout');
    expect(remodulerState.state.tasksFailed).toBe(1);
  });

  it('handles pause/stop requests', () => {
    expect(remodulerState.isPauseRequested()).toBe(false);
    remodulerState.requestPause();
    expect(remodulerState.isPauseRequested()).toBe(true);
    remodulerState.requestStop();
    expect(remodulerState.isStopRequested()).toBe(true);
  });

  it('emits events on changes', () => {
    const fn = vi.fn();
    eventBus.on('state:execution', fn);
    remodulerState.setExecution('running');
    expect(fn).toHaveBeenCalledWith({ execution: 'running' });
  });
});

// --- [1.7] Checkpoint Manager ---
describe('checkpointManager', () => {
  let cm;
  let testDir;

  beforeEach(() => {
    testDir = join(tmpdir(), `remoduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    cm = new CheckpointManager(testDir);
  });

  it('saves and lists checkpoints', async () => {
    await cm.save({ taskId: 'T1', agent: 'CODER', phase: 'review' });
    const list = await cm.list();
    expect(list.length).toBe(1);
    expect(list[0].taskId).toBe('T1');
  });

  it('gets latest', async () => {
    await cm.save({ taskId: 'T1' });
    await new Promise(r => setTimeout(r, 10));
    await cm.save({ taskId: 'T2' });
    const latest = await cm.getLatest();
    expect(latest.taskId).toBe('T2');
  });

  it('validates freshness', () => {
    expect(cm.isValid({ taskId: 'T1', savedAt: Date.now() })).toBe(true);
    expect(cm.isValid({ taskId: 'T1', savedAt: Date.now() - 25 * 60 * 60 * 1000 })).toBe(false);
    expect(cm.isValid(null)).toBe(false);
  });

  it('removes checkpoint', async () => {
    await cm.save({ taskId: 'T1' });
    const list = await cm.list();
    await cm.remove(list[0]);
    expect((await cm.list()).length).toBe(0);
  });
});

// --- [1.8] Config ---
describe('config', () => {
  it('has default values', () => {
    expect(config.cliPlanner).toBe('claude');
    expect(config.maxReviewCycles).toBe(3);
    expect(config.dailyBudgetUsd).toBe(10);
    expect(config.wsPort).toBe(3001);
  });

  it('validateConfig returns valid when CLIs exist', () => {
    const result = validateConfig();
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
  });
});
