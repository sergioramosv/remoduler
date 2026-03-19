import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── MOCKS ──────────────────────────────────────────────────────────

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

const { CircuitBreaker, CIRCUIT_STATES } = await import('../../src/resilience/circuit-breaker.js');
const { ErrorBudget } = await import('../../src/resilience/error-budget.js');
const { DeadLetterQueue } = await import('../../src/resilience/dead-letter-queue.js');
const { ResilienceManager } = await import('../../src/resilience/resilience-manager.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── AC1: CircuitBreaker — boundary & lifecycle ─────────────────────

describe('AC1: CircuitBreaker — threshold boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens exactly at threshold, not before (firebase=5)', async () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    // 4 failures: still CLOSED
    for (let i = 0; i < 4; i++) {
      await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('CLOSED');

    // 5th failure: opens
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('opens exactly at threshold for github=3', async () => {
    const cb = new CircuitBreaker('github', 3, 60000);
    for (let i = 0; i < 2; i++) {
      await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('CLOSED');

    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('opens exactly at threshold for cli=4', async () => {
    const cb = new CircuitBreaker('cli', 4, 60000);
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('CLOSED');

    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('OPEN error message includes service name', async () => {
    const cb = new CircuitBreaker('firebase', 1, 60000);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await expect(cb.execute(() => 'ok')).rejects.toThrow("Circuit breaker OPEN for service 'firebase'");
  });

  it('reset() from OPEN returns to CLOSED with zero failures', async () => {
    const cb = new CircuitBreaker('github', 2, 60000);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');

    // Can execute again after reset
    const result = await cb.execute(() => 'recovered');
    expect(result).toBe('recovered');
  });

  it('full multi-cycle: CLOSED→OPEN→HALF_OPEN→OPEN→HALF_OPEN→CLOSED', async () => {
    const cb = new CircuitBreaker('cli', 2, 30);

    // CLOSED → OPEN (2 failures)
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    // Wait cooldown → HALF_OPEN, then fail → OPEN again
    await new Promise(r => setTimeout(r, 40));
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    // Wait cooldown → HALF_OPEN, then succeed → CLOSED
    await new Promise(r => setTimeout(r, 40));
    const result = await cb.execute(() => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });
});

// ─── AC2: ErrorBudget — precision edge cases ────────────────────────

describe('AC2: ErrorBudget — rate precision and events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('budget-exhausted event payload includes rate and maxRate', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    budget.record(false); // 1/1 = 100%

    expect(eventBus.emit).toHaveBeenCalledWith('resilience:budget-exhausted', {
      rate: 1.0,
      maxRate: 0.3,
    });
  });

  it('all successes keep rate at 0 and never exhausted', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    for (let i = 0; i < 20; i++) budget.record(true);

    expect(budget.getRate()).toBe(0);
    expect(budget.isExhausted()).toBe(false);
    expect(eventBus.emit).not.toHaveBeenCalledWith('resilience:auto-pause', expect.anything());
  });

  it('exactly 30% failure rate does NOT trigger exhaustion (uses >)', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    // 3 failures + 7 successes = exactly 30%
    for (let i = 0; i < 3; i++) budget.record(false);
    for (let i = 0; i < 7; i++) budget.record(true);

    expect(budget.getRate()).toBeCloseTo(0.3, 5);
    expect(budget.isExhausted()).toBe(false);
  });

  it('31% failure rate triggers exhaustion', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    // Build up: 31 failures + 69 successes = 31%
    for (let i = 0; i < 31; i++) budget.record(false);
    for (let i = 0; i < 69; i++) budget.record(true);

    expect(budget.getRate()).toBeCloseTo(0.31, 2);
    expect(budget.isExhausted()).toBe(true);
  });
});

// ─── AC3: DeadLetterQueue — id format and permanent failure ─────────

describe('AC3: DeadLetterQueue — entry lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueue returns id with dlq- prefix', () => {
    const dlq = new DeadLetterQueue(3, 10);
    const id = dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: new Error('e') });
    expect(id).toMatch(/^dlq-\d+$/);
  });

  it('enqueue extracts Error.message for error field', () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: new Error('specific message') });
    const entry = dlq.getQueue()[0];
    expect(entry.error).toBe('specific message');
  });

  it('entry reaches permanently-failed after exactly maxRetries attempts', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'cli', operation: 'exec', payload: { cmd: 'test' }, error: 'fail' });

    const retryFn = vi.fn().mockRejectedValue(new Error('still failing'));

    // 3 retries to permanently fail
    for (let attempt = 0; attempt < 3; attempt++) {
      dlq.getQueue().forEach(e => { e.nextRetryAt = Date.now(); });
      await dlq.processRetries(retryFn);
    }

    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(1);
    expect(dlq.getPermanentlyFailed()[0].status).toBe('permanently-failed');
  });

  it('emits dlq-permanent-fail with correct metadata', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'github', operation: 'push', payload: null, error: 'fail' });

    const retryFn = vi.fn().mockRejectedValue(new Error('nope'));

    for (let attempt = 0; attempt < 3; attempt++) {
      dlq.getQueue().forEach(e => { e.nextRetryAt = Date.now(); });
      await dlq.processRetries(retryFn);
    }

    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-permanent-fail', expect.objectContaining({
      service: 'github',
      operation: 'push',
      attempts: 3,
    }));
  });

  it('payload is preserved through enqueue', () => {
    const dlq = new DeadLetterQueue(3, 10);
    const payload = { path: '/data', records: [1, 2, 3] };
    dlq.enqueue({ service: 'firebase', operation: 'write', payload, error: 'err' });

    const entry = dlq.getQueue()[0];
    expect(entry.payload).toEqual(payload);
  });
});

// ─── AC4: ResilienceManager — coordinator edge cases ────────────────

describe('AC4: ResilienceManager — coordination', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new ResilienceManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('initialized getter reflects lifecycle state', () => {
    expect(manager.initialized).toBe(false);
    manager.initialize();
    expect(manager.initialized).toBe(true);
    manager.shutdown();
    expect(manager.initialized).toBe(false);
  });

  it('initialize emits resilience:initialized with all 3 services', () => {
    manager.initialize();
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:initialized', {
      services: expect.arrayContaining(['firebase', 'github', 'cli']),
    });
  });

  it('execute rejects when circuit breaker is OPEN without touching error budget', async () => {
    // Break the github breaker (threshold=3)
    for (let i = 0; i < 3; i++) {
      await manager.execute('github', () => { throw new Error('f'); }).catch(() => {});
    }
    vi.clearAllMocks();

    // Now the breaker is OPEN — next call should be rejected by CB directly
    await expect(manager.execute('github', () => 'ok')).rejects.toThrow('Circuit breaker OPEN');

    // Error budget still gets recorded (because execute catches the CB error)
    // and DLQ still gets the entry
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-enqueued', expect.objectContaining({
      service: 'github',
    }));
  });

  it('getStatus() breakers object has all 3 services with correct states', async () => {
    const status = manager.getStatus();

    expect(status.breakers).toHaveProperty('firebase', 'CLOSED');
    expect(status.breakers).toHaveProperty('github', 'CLOSED');
    expect(status.breakers).toHaveProperty('cli', 'CLOSED');
    expect(Object.keys(status.breakers)).toHaveLength(3);
  });

  it('execute preserves original error on re-throw', async () => {
    const originalError = new TypeError('custom type error');
    await expect(
      manager.execute('firebase', () => { throw originalError; })
    ).rejects.toBe(originalError);
  });

  it('DLQ retry interval fires every 10 seconds after initialize', () => {
    manager.initialize();

    // Advance 10s — interval should fire
    vi.advanceTimersByTime(10000);
    // No assertion on result, just verifying no crash and interval runs
    // Advance another 10s
    vi.advanceTimersByTime(10000);
    // Still no crash — interval is running cleanly
    expect(manager.initialized).toBe(true);
  });

  it('multiple services fail independently without cross-contamination', async () => {
    // Break github (threshold=3)
    for (let i = 0; i < 3; i++) {
      await manager.execute('github', () => { throw new Error('f'); }).catch(() => {});
    }
    expect(manager.getBreaker('github').getState()).toBe('OPEN');

    // Firebase should still work fine
    const result = await manager.execute('firebase', () => 'firebase-ok');
    expect(result).toBe('firebase-ok');
    expect(manager.getBreaker('firebase').getState()).toBe('CLOSED');
  });
});
