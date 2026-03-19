import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    autonomyDiffThreshold: 500,
    autonomyMaxCyclesThreshold: 3,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { GuardianGates } = await import('../../src/autonomy/guardian-gates.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('GuardianGates — Acceptance Criteria', () => {
  let gates;

  beforeEach(() => {
    vi.clearAllMocks();
    gates = new GuardianGates();
  });

  it('AC: diff>500 lines triggers diffSize gate', () => {
    const results = gates.evaluate({ diffLines: 600 });
    const diffGate = results.find(r => r.gate === 'diffSize');
    expect(diffGate.triggered).toBe(true);
    expect(diffGate.reason).toContain('600');
    expect(diffGate.reason).toContain('500');
  });

  it('AC: diff<=500 does not trigger diffSize gate', () => {
    const results = gates.evaluate({ diffLines: 500 });
    const diffGate = results.find(r => r.gate === 'diffSize');
    expect(diffGate.triggered).toBe(false);
  });

  it('AC: security files trigger securityFiles gate', () => {
    const results = gates.evaluate({ filesChanged: ['src/auth/login.js', '.env.local'] });
    const secGate = results.find(r => r.gate === 'securityFiles');
    expect(secGate.triggered).toBe(true);
    expect(secGate.reason).toContain('auth');
  });

  it('AC: >3 cycles triggers reviewCycles gate', () => {
    const results = gates.evaluate({ cycles: 4 });
    const cycleGate = results.find(r => r.gate === 'reviewCycles');
    expect(cycleGate.triggered).toBe(true);
  });

  it('AC: DB migration files trigger dbMigration gate', () => {
    const results = gates.evaluate({ filesChanged: ['db/migration_001.sql'] });
    const dbGate = results.find(r => r.gate === 'dbMigration');
    expect(dbGate.triggered).toBe(true);
  });

  it('AC: dependency files trigger depsChanged gate', () => {
    const results = gates.evaluate({ filesChanged: ['package.json', 'src/index.js'] });
    const depsGate = results.find(r => r.gate === 'depsChanged');
    expect(depsGate.triggered).toBe(true);
    expect(depsGate.reason).toContain('package.json');
  });

  it('AC: evaluate returns all 5 gate results', () => {
    const results = gates.evaluate({});
    expect(results).toHaveLength(5);
    const gateNames = results.map(r => r.gate);
    expect(gateNames).toEqual(['diffSize', 'securityFiles', 'reviewCycles', 'dbMigration', 'depsChanged']);
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('GuardianGates — Unit', () => {
  let gates;

  beforeEach(() => {
    vi.clearAllMocks();
    gates = new GuardianGates();
  });

  it('each gate result has gate, triggered, reason properties', () => {
    const results = gates.evaluate({});
    for (const r of results) {
      expect(r).toHaveProperty('gate');
      expect(r).toHaveProperty('triggered');
      expect(r).toHaveProperty('reason');
    }
  });

  it('non-triggered gates have empty reason string', () => {
    const results = gates.evaluate({});
    for (const r of results) {
      if (!r.triggered) {
        expect(r.reason).toBe('');
      }
    }
  });

  it('detects all security patterns', () => {
    const securityFiles = ['.env', 'src/auth.js', 'secret.txt', 'credential.json', 'token.js', 'api-key.txt', 'password.cfg'];
    for (const file of securityFiles) {
      const results = gates.evaluate({ filesChanged: [file] });
      const secGate = results.find(r => r.gate === 'securityFiles');
      expect(secGate.triggered).toBe(true);
    }
  });

  it('detects all dependency file types', () => {
    const depFiles = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    for (const file of depFiles) {
      const results = gates.evaluate({ filesChanged: [file] });
      const depsGate = results.find(r => r.gate === 'depsChanged');
      expect(depsGate.triggered).toBe(true);
    }
  });

  it('detects deps files in subdirectories', () => {
    const results = gates.evaluate({ filesChanged: ['frontend/package.json'] });
    const depsGate = results.find(r => r.gate === 'depsChanged');
    expect(depsGate.triggered).toBe(true);
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('GuardianGates — Edge Cases', () => {
  let gates;

  beforeEach(() => {
    vi.clearAllMocks();
    gates = new GuardianGates();
  });

  it('empty context triggers no gates', () => {
    const results = gates.evaluate({});
    const triggered = results.filter(r => r.triggered);
    expect(triggered).toHaveLength(0);
  });

  it('undefined context triggers no gates', () => {
    const results = gates.evaluate();
    const triggered = results.filter(r => r.triggered);
    expect(triggered).toHaveLength(0);
  });

  it('null filesChanged triggers no file-related gates', () => {
    const results = gates.evaluate({ filesChanged: null });
    const fileGates = results.filter(r => ['securityFiles', 'dbMigration', 'depsChanged'].includes(r.gate));
    expect(fileGates.every(r => !r.triggered)).toBe(true);
  });

  it('empty filesChanged array triggers no file-related gates', () => {
    const results = gates.evaluate({ filesChanged: [] });
    const fileGates = results.filter(r => ['securityFiles', 'dbMigration', 'depsChanged'].includes(r.gate));
    expect(fileGates.every(r => !r.triggered)).toBe(true);
  });

  it('cycles=0 does not trigger reviewCycles', () => {
    const results = gates.evaluate({ cycles: 0 });
    const cycleGate = results.find(r => r.gate === 'reviewCycles');
    expect(cycleGate.triggered).toBe(false);
  });

  it('cycles exactly at threshold (3) does not trigger', () => {
    const results = gates.evaluate({ cycles: 3 });
    const cycleGate = results.find(r => r.gate === 'reviewCycles');
    expect(cycleGate.triggered).toBe(false);
  });

  it('diffLines=0 does not trigger diffSize', () => {
    const results = gates.evaluate({ diffLines: 0 });
    const diffGate = results.find(r => r.gate === 'diffSize');
    expect(diffGate.triggered).toBe(false);
  });

  it('multiple gates can trigger simultaneously', () => {
    const results = gates.evaluate({
      diffLines: 1000,
      cycles: 5,
      filesChanged: ['.env', 'migration.sql', 'package.json'],
    });
    const triggered = results.filter(r => r.triggered);
    expect(triggered.length).toBeGreaterThanOrEqual(4);
  });
});
