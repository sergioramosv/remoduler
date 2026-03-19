import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing modules
vi.mock('../../src/config.js', () => ({
  config: {
    autonomyLevel: 'semi-autonomous',
    autonomyApprovalTimeoutMs: 300000,
    autonomyDiffThreshold: 500,
    autonomyMaxCyclesThreshold: 3,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() },
}));

vi.mock('../../src/autonomy/approval-channels.js', () => ({
  approvalChannels: {
    notifyChannels: vi.fn(),
    listenForResponse: vi.fn(),
    getChannels: vi.fn(() => [{ name: 'dashboard', active: true }, { name: 'api', active: true }]),
    registerChannel: vi.fn(),
  },
}));

// We need to mock approval-gate partially — import after mocks
vi.mock('../../src/autonomy/approval-gate.js', () => {
  const gate = {
    waitForApproval: vi.fn(),
  };
  return { ApprovalGate: vi.fn(() => gate), approvalGate: gate };
});

vi.mock('../../src/autonomy/guardian-gates.js', () => {
  const gates = {
    evaluate: vi.fn(() => [
      { gate: 'diffSize', triggered: false, reason: '' },
      { gate: 'securityFiles', triggered: false, reason: '' },
      { gate: 'reviewCycles', triggered: false, reason: '' },
      { gate: 'dbMigration', triggered: false, reason: '' },
      { gate: 'depsChanged', triggered: false, reason: '' },
    ]),
  };
  return { GuardianGates: vi.fn(() => gates), guardianGates: gates };
});

const { AutonomyEngine, AUTONOMY_LEVELS } = await import('../../src/autonomy/autonomy-engine.js');
const { guardianGates } = await import('../../src/autonomy/guardian-gates.js');
const { approvalGate } = await import('../../src/autonomy/approval-gate.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('Autonomy Engine — Acceptance Criteria', () => {
  let engine;

  beforeEach(() => {
    vi.clearAllMocks();
    guardianGates.evaluate.mockReturnValue([
      { gate: 'diffSize', triggered: false, reason: '' },
      { gate: 'securityFiles', triggered: false, reason: '' },
      { gate: 'reviewCycles', triggered: false, reason: '' },
      { gate: 'dbMigration', triggered: false, reason: '' },
      { gate: 'depsChanged', triggered: false, reason: '' },
    ]);
    engine = new AutonomyEngine();
  });

  it('AC1: exports exactly 4 autonomy levels (supervised, semi-autonomous, autonomous, guardian)', () => {
    expect(AUTONOMY_LEVELS).toEqual({
      SUPERVISED: 'supervised',
      SEMI_AUTONOMOUS: 'semi-autonomous',
      AUTONOMOUS: 'autonomous',
      GUARDIAN: 'guardian',
    });
    expect(Object.keys(AUTONOMY_LEVELS)).toHaveLength(4);
  });

  it('AC1: engine supports all 4 levels via setLevel/getLevel', () => {
    for (const level of Object.values(AUTONOMY_LEVELS)) {
      engine.setLevel(level);
      expect(engine.getLevel()).toBe(level);
    }
  });

  it('AC2: SUPERVISED level always requires approval', async () => {
    engine.setLevel('supervised');
    approvalGate.waitForApproval.mockResolvedValue({ approved: true, respondedBy: 'user', timedOut: false });

    const result = await engine.checkGate('pre-code', {});
    expect(approvalGate.waitForApproval).toHaveBeenCalled();
    expect(result.allowed).toBe(true);
  });

  it('AC2: SEMI_AUTONOMOUS only asks approval when gates trigger', async () => {
    engine.setLevel('semi-autonomous');

    // No gates triggered — should allow without approval
    const result1 = await engine.checkGate('pre-code', {});
    expect(approvalGate.waitForApproval).not.toHaveBeenCalled();
    expect(result1.allowed).toBe(true);

    // Now trigger a gate
    guardianGates.evaluate.mockReturnValue([
      { gate: 'diffSize', triggered: true, reason: 'Diff size (600) exceeds threshold (500)' },
    ]);
    approvalGate.waitForApproval.mockResolvedValue({ approved: false, respondedBy: 'user', timedOut: false });

    const result2 = await engine.checkGate('pre-code', {});
    expect(approvalGate.waitForApproval).toHaveBeenCalled();
    expect(result2.allowed).toBe(false);
  });

  it('AC2: AUTONOMOUS always allows even with triggered gates', async () => {
    engine.setLevel('autonomous');
    guardianGates.evaluate.mockReturnValue([
      { gate: 'diffSize', triggered: true, reason: 'Diff size (600) exceeds threshold (500)' },
    ]);

    const result = await engine.checkGate('pre-code', {});
    expect(result.allowed).toBe(true);
    expect(approvalGate.waitForApproval).not.toHaveBeenCalled();
  });

  it('AC2: GUARDIAN auto-blocks when gates triggered without human approval', async () => {
    engine.setLevel('guardian');
    guardianGates.evaluate.mockReturnValue([
      { gate: 'securityFiles', triggered: true, reason: 'Security-sensitive files modified: .env' },
    ]);

    const result = await engine.checkGate('pre-code', {});
    expect(result.allowed).toBe(false);
    expect(result.approval).toBeNull();
    expect(approvalGate.waitForApproval).not.toHaveBeenCalled();
  });

  it('AC2: GUARDIAN allows when no gates triggered', async () => {
    engine.setLevel('guardian');
    const result = await engine.checkGate('pre-code', {});
    expect(result.allowed).toBe(true);
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('AutonomyEngine — Unit', () => {
  let engine;

  beforeEach(() => {
    vi.clearAllMocks();
    guardianGates.evaluate.mockReturnValue([
      { gate: 'diffSize', triggered: false, reason: '' },
    ]);
    engine = new AutonomyEngine();
  });

  it('defaults to semi-autonomous level from config', () => {
    expect(engine.getLevel()).toBe('semi-autonomous');
  });

  it('setLevel emits autonomy:level-changed event', () => {
    engine.setLevel('autonomous');
    expect(eventBus.emit).toHaveBeenCalledWith('autonomy:level-changed', {
      previous: 'semi-autonomous',
      current: 'autonomous',
    });
  });

  it('checkGate emits autonomy:gate-check event', async () => {
    await engine.checkGate('pre-merge', { filesChanged: [] });
    expect(eventBus.emit).toHaveBeenCalledWith('autonomy:gate-check', expect.objectContaining({
      action: 'pre-merge',
    }));
  });

  it('checkGate returns reasons from triggered gates', async () => {
    engine.setLevel('autonomous');
    guardianGates.evaluate.mockReturnValue([
      { gate: 'diffSize', triggered: true, reason: 'Big diff' },
      { gate: 'securityFiles', triggered: true, reason: 'Sensitive files' },
    ]);

    const result = await engine.checkGate('pre-code', {});
    expect(result.reasons).toEqual(['Big diff', 'Sensitive files']);
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('AutonomyEngine — Edge Cases', () => {
  let engine;

  beforeEach(() => {
    vi.clearAllMocks();
    guardianGates.evaluate.mockReturnValue([]);
    engine = new AutonomyEngine();
  });

  it('invalid level falls back to semi-autonomous', () => {
    engine.setLevel('invalid-level');
    expect(engine.getLevel()).toBe('semi-autonomous');
  });

  it('setLevel with null falls back to semi-autonomous', () => {
    engine.setLevel(null);
    expect(engine.getLevel()).toBe('semi-autonomous');
  });

  it('setLevel with undefined falls back to semi-autonomous', () => {
    engine.setLevel(undefined);
    expect(engine.getLevel()).toBe('semi-autonomous');
  });

  it('checkGate with empty context works', async () => {
    engine.setLevel('autonomous');
    const result = await engine.checkGate('test-action');
    expect(result.allowed).toBe(true);
  });
});
