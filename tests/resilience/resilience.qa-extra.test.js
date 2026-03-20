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

const { CircuitBreaker, CIRCUIT_STATES } = await import('../../src/resilience/circuit-breaker.js');
const { ErrorBudget } = await import('../../src/resilience/error-budget.js');
const { DeadLetterQueue } = await import('../../src/resilience/dead-letter-queue.js');
const { ResilienceManager } = await import('../../src/resilience/resilience-manager.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ═══════════════════════════════════════════════════════════════════════
// AC1 — Extra: CircuitBreaker edge cases & acceptance gaps
// ═══════════════════════════════════════════════════════════════════════

describe('QA Extra — AC1: CircuitBreaker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CIRCUIT_STATES values are strings matching their keys', () => {
    expect(CIRCUIT_STATES.CLOSED).toBe('CLOSED');
    expect(CIRCUIT_STATES.OPEN).toBe('OPEN');
    expect(CIRCUIT_STATES.HALF_OPEN).toBe('HALF_OPEN');
  });

  it('multiple open-close cycles work correctly', async () => {
    const cb = new CircuitBreaker('github', 2, 30);

    // Cycle 1: CLOSED → OPEN → HALF_OPEN → CLOSED
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await new Promise(r => setTimeout(r, 40));
    await cb.execute(() => 'ok');
    expect(cb.getState()).toBe('CLOSED');

    // Cycle 2: should work the same
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await new Promise(r => setTimeout(r, 40));
    await cb.execute(() => 'recovered again');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('execute() propagates the original error, not a circuit breaker error', async () => {
    const cb = new CircuitBreaker('cli', 5, 60000);
    const specificError = new Error('ECONNREFUSED');
    await expect(cb.execute(() => { throw specificError; })).rejects.toThrow('ECONNREFUSED');
  });

  it('execute() works with async functions that resolve', async () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    const result = await cb.execute(async () => {
      await new Promise(r => setTimeout(r, 5));
      return 'async-result';
    });
    expect(result).toBe('async-result');
  });

  it('cooldown 60s: OPEN state does NOT transition before cooldown', async () => {
    const cb = new CircuitBreaker('github', 2, 60000);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    // Immediately try — should still be OPEN (60s hasn't passed)
    await expect(cb.execute(() => 'x')).rejects.toThrow(/Circuit breaker OPEN/);
    expect(cb.getState()).toBe('OPEN');
  });

  it('different services have independent failure counters', async () => {
    const cbFirebase = new CircuitBreaker('firebase', 5, 60000);
    const cbGithub = new CircuitBreaker('github', 3, 60000);

    // 2 failures on firebase
    await cbFirebase.execute(() => { throw new Error('f'); }).catch(() => {});
    await cbFirebase.execute(() => { throw new Error('f'); }).catch(() => {});

    // 3 failures on github → opens
    for (let i = 0; i < 3; i++) {
      await cbGithub.execute(() => { throw new Error('f'); }).catch(() => {});
    }

    expect(cbFirebase.getState()).toBe('CLOSED'); // still below threshold=5
    expect(cbGithub.getState()).toBe('OPEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC2 — Extra: ErrorBudget edge cases
// ═══════════════════════════════════════════════════════════════════════

describe('QA Extra — AC2: ErrorBudget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('all successes give rate=0 and not exhausted', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    for (let i = 0; i < 10; i++) budget.record(true);
    expect(budget.getRate()).toBe(0);
    expect(budget.isExhausted()).toBe(false);
  });

  it('boundary: 31% failure rate triggers exhaustion (just above threshold)', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    // 69 successes + 31 failures = 31% > 30%
    for (let i = 0; i < 69; i++) budget.record(true);
    for (let i = 0; i < 31; i++) budget.record(false);
    expect(budget.getRate()).toBeCloseTo(0.31, 2);
    expect(budget.isExhausted()).toBe(true);
  });

  it('recovery: exhausted becomes false when rate drops below threshold', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    // Exhaust: 100% failure
    budget.record(false);
    expect(budget.isExhausted()).toBe(true);

    // Recover: add enough successes → 1/11 ≈ 9%
    for (let i = 0; i < 10; i++) budget.record(true);
    expect(budget.isExhausted()).toBe(false);
  });

  it('reset after exhaustion allows re-recording from scratch', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    budget.record(false);
    budget.record(false);
    expect(budget.isExhausted()).toBe(true);

    budget.reset();
    budget.record(true);
    expect(budget.getRate()).toBe(0);
    expect(budget.isExhausted()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC3 — Extra: DeadLetterQueue edge cases
// ═══════════════════════════════════════════════════════════════════════

describe('QA Extra — AC3: DeadLetterQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueue generates sequential IDs', () => {
    const dlq = new DeadLetterQueue(3, 10);
    const id1 = dlq.enqueue({ service: 'firebase', operation: 'a', payload: null, error: 'e' });
    const id2 = dlq.enqueue({ service: 'github', operation: 'b', payload: null, error: 'e' });
    // IDs should be unique and sequential
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^dlq-\d+$/);
    expect(id2).toMatch(/^dlq-\d+$/);
  });

  it('entry has all required fields after enqueue', () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'save', payload: { key: 'val' }, error: new Error('fail') });
    const entry = dlq.getQueue()[0];

    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('service', 'firebase');
    expect(entry).toHaveProperty('operation', 'save');
    expect(entry).toHaveProperty('payload');
    expect(entry.payload).toEqual({ key: 'val' });
    expect(entry).toHaveProperty('error', 'fail');
    expect(entry).toHaveProperty('attempts', 0);
    expect(entry).toHaveProperty('nextRetryAt');
    expect(entry).toHaveProperty('status', 'pending');
  });

  it('backoff values: 1s, 2s, 4s for baseDelay=1000', async () => {
    const dlq = new DeadLetterQueue(3, 1000);
    dlq.enqueue({ service: 'cli', operation: 'exec', payload: null, error: 'err' });
    const retryFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Attempt 1 → nextRetryAt ≈ now + 1000*2^1 = 2000ms (2s)
    dlq.getQueue()[0].nextRetryAt = Date.now();
    const t0 = Date.now();
    await dlq.processRetries(retryFn);
    const after1 = dlq.getQueue()[0];
    expect(after1.nextRetryAt).toBeGreaterThanOrEqual(t0 + 2000 - 50);
    expect(after1.nextRetryAt).toBeLessThanOrEqual(t0 + 2000 + 200);

    // Attempt 2 → nextRetryAt ≈ now + 1000*2^2 = 4000ms (4s)
    after1.nextRetryAt = Date.now();
    const t1 = Date.now();
    await dlq.processRetries(retryFn);
    const after2 = dlq.getQueue()[0];
    expect(after2.nextRetryAt).toBeGreaterThanOrEqual(t1 + 4000 - 50);
    expect(after2.nextRetryAt).toBeLessThanOrEqual(t1 + 4000 + 200);

    // Attempt 3 → permanently-failed
    after2.nextRetryAt = Date.now();
    await dlq.processRetries(retryFn);
    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(1);
    expect(dlq.getPermanentlyFailed()[0].attempts).toBe(3);
  });

  it('getPermanentlyFailed entries have status permanently-failed', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'github', operation: 'push', payload: null, error: 'err' });
    const retryFn = vi.fn().mockRejectedValue(new Error('nope'));

    for (let i = 0; i < 3; i++) {
      const q = dlq.getQueue();
      if (q.length > 0) q[0].nextRetryAt = Date.now();
      await dlq.processRetries(retryFn);
    }

    const failed = dlq.getPermanentlyFailed();
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe('permanently-failed');
    expect(failed[0].service).toBe('github');
  });

  it('successful retry after 2 failed attempts resolves the entry', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'save', payload: null, error: 'err' });

    // Fail twice
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 2; i++) {
      const q = dlq.getQueue();
      if (q.length > 0) q[0].nextRetryAt = Date.now();
      await dlq.processRetries(failFn);
    }
    expect(dlq.size()).toBe(1);
    expect(dlq.getQueue()[0].attempts).toBe(2);

    // Succeed on third attempt
    dlq.getQueue()[0].nextRetryAt = Date.now();
    await dlq.processRetries(async () => 'ok');
    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC4 — Extra: ResilienceManager integration & edge cases
// ═══════════════════════════════════════════════════════════════════════

describe('QA Extra — AC4: ResilienceManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ResilienceManager();
  });

  afterEach(() => manager.shutdown());

  it('each service gets a breaker with its configured threshold', async () => {
    // firebase threshold=5: 4 failures → still CLOSED
    for (let i = 0; i < 4; i++) {
      await manager.execute('firebase', () => { throw new Error('f'); }).catch(() => {});
    }
    expect(manager.getStatus().breakers.firebase).toBe('CLOSED');

    // 5th failure → OPEN
    await manager.execute('firebase', () => { throw new Error('f'); }).catch(() => {});
    expect(manager.getStatus().breakers.firebase).toBe('OPEN');

    // cli threshold=4: 3 failures → still CLOSED
    for (let i = 0; i < 3; i++) {
      await manager.execute('cli', () => { throw new Error('f'); }).catch(() => {});
    }
    expect(manager.getStatus().breakers.cli).toBe('CLOSED');

    // 4th → OPEN
    await manager.execute('cli', () => { throw new Error('f'); }).catch(() => {});
    expect(manager.getStatus().breakers.cli).toBe('OPEN');
  });

  it('DLQ accumulates failures from multiple services', async () => {
    await manager.execute('firebase', () => { throw new Error('f1'); }).catch(() => {});
    await manager.execute('github', () => { throw new Error('f2'); }).catch(() => {});
    await manager.execute('cli', () => { throw new Error('f3'); }).catch(() => {});

    expect(manager.getStatus().dlqSize).toBe(3);
  });

  it('error budget tracks all service failures together', async () => {
    // 1 success + 1 failure = 50% rate
    await manager.execute('firebase', () => 'ok');
    await manager.execute('github', () => { throw new Error('f'); }).catch(() => {});

    const status = manager.getStatus();
    expect(status.errorBudgetRate).toBeCloseTo(0.5, 2);
    expect(status.errorBudgetExhausted).toBe(true);
  });

  it('getStatus() dlqPermanentlyFailed is 0 initially', () => {
    expect(manager.getStatus().dlqPermanentlyFailed).toBe(0);
  });

  it('execute() re-throws the original error', async () => {
    const err = new Error('specific-service-error');
    await expect(manager.execute('firebase', () => { throw err; })).rejects.toThrow('specific-service-error');
  });

  it('successful execution does not enqueue to DLQ', async () => {
    await manager.execute('firebase', () => 'ok');
    await manager.execute('github', () => 'ok');
    expect(manager.getStatus().dlqSize).toBe(0);
  });
});
