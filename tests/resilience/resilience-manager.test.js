import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    resilienceThresholds: { firebase: 5, github: 3, cli: 4 },
    resilienceCooldownMs: 60000,
    resilienceErrorBudgetWindowMs: 1800000,
    resilienceErrorBudgetMaxRate: 0.3,
    resilienceDlqMaxRetries: 3,
    resilienceDlqBaseDelayMs: 1000,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() },
}));

const { ResilienceManager } = await import('../../src/resilience/resilience-manager.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('ResilienceManager — Acceptance Criteria', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ResilienceManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('AC4: creates circuit breakers for firebase, github, cli', () => {
    const status = manager.getStatus();
    expect(status.breakers).toEqual({
      firebase: 'CLOSED',
      github: 'CLOSED',
      cli: 'CLOSED',
    });
  });

  it('AC4: execute() routes through circuit breaker and returns result', async () => {
    const result = await manager.execute('firebase', () => 'data');
    expect(result).toBe('data');
  });

  it('AC4: execute() records success in error budget', async () => {
    await manager.execute('firebase', () => 'ok');
    const status = manager.getStatus();
    expect(status.errorBudgetRate).toBe(0);
  });

  it('AC4: execute() records failure in error budget and enqueues to DLQ', async () => {
    await expect(manager.execute('github', () => { throw new Error('api-down'); })).rejects.toThrow('api-down');

    const status = manager.getStatus();
    expect(status.errorBudgetRate).toBe(1.0);
    expect(status.dlqSize).toBe(1);
  });

  it('AC4: getStatus() returns complete status', () => {
    const status = manager.getStatus();
    expect(status).toHaveProperty('breakers');
    expect(status).toHaveProperty('errorBudgetRate');
    expect(status).toHaveProperty('errorBudgetExhausted');
    expect(status).toHaveProperty('dlqSize');
    expect(status).toHaveProperty('dlqPermanentlyFailed');
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('ResilienceManager — Unit', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ResilienceManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('initialize() sets up DLQ retry interval and emits event', () => {
    manager.initialize();
    expect(manager.initialized).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:initialized', expect.objectContaining({
      services: ['firebase', 'github', 'cli'],
    }));
  });

  it('initialize() is idempotent', () => {
    manager.initialize();
    manager.initialize();
    const initCalls = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:initialized');
    expect(initCalls).toHaveLength(1);
  });

  it('shutdown() clears retry interval', () => {
    manager.initialize();
    manager.shutdown();
    expect(manager.initialized).toBe(false);
  });

  it('execute() throws for unknown service', async () => {
    await expect(manager.execute('unknown', () => 'x')).rejects.toThrow("Unknown service 'unknown'");
  });

  it('getBreaker() returns circuit breaker for service', () => {
    const breaker = manager.getBreaker('firebase');
    expect(breaker).toBeDefined();
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('circuit breaker opens after threshold failures', async () => {
    // GitHub threshold = 3
    for (let i = 0; i < 3; i++) {
      await manager.execute('github', () => { throw new Error('fail'); }).catch(() => {});
    }
    const status = manager.getStatus();
    expect(status.breakers.github).toBe('OPEN');
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('ResilienceManager — Edge Cases', () => {
  it('multiple failures accumulate in error budget', async () => {
    const manager = new ResilienceManager();

    // 4 successes, then failures
    for (let i = 0; i < 4; i++) {
      await manager.execute('firebase', () => 'ok');
    }

    // 2 failures — rate should be 2/6 ≈ 33%
    for (let i = 0; i < 2; i++) {
      await manager.execute('firebase', () => { throw new Error('f'); }).catch(() => {});
    }

    const status = manager.getStatus();
    expect(status.errorBudgetRate).toBeCloseTo(2 / 6, 2);
    expect(status.errorBudgetExhausted).toBe(true);

    manager.shutdown();
  });

  it('shutdown without initialize does not throw', () => {
    const manager = new ResilienceManager();
    expect(() => manager.shutdown()).not.toThrow();
  });
});
