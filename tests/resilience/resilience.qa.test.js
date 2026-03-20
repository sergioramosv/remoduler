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
// AC1: circuit-breaker.js — CLOSED→OPEN→HALF_OPEN states,
//       thresholds per service (firebase=5, github=3, cli=4), cooldown 60s
// ═══════════════════════════════════════════════════════════════════════

describe('QA — AC1: CircuitBreaker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes exactly three states: CLOSED, OPEN, HALF_OPEN', () => {
    const keys = Object.keys(CIRCUIT_STATES).sort();
    expect(keys).toEqual(['CLOSED', 'HALF_OPEN', 'OPEN']);
    expect(Object.values(CIRCUIT_STATES)).toEqual(expect.arrayContaining(['CLOSED', 'OPEN', 'HALF_OPEN']));
  });

  it('starts in CLOSED state by default', () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    expect(cb.getState()).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('firebase threshold=5: stays CLOSED after 4 failures, opens at 5', async () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    for (let i = 0; i < 4; i++) {
      await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('CLOSED');
    await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('github threshold=3: opens after exactly 3 failures', async () => {
    const cb = new CircuitBreaker('github', 3, 60000);
    for (let i = 0; i < 2; i++) {
      await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('CLOSED');
    await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('cli threshold=4: opens after exactly 4 failures', async () => {
    const cb = new CircuitBreaker('cli', 4, 60000);
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('CLOSED');
    await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('OPEN rejects calls before cooldown expires', async () => {
    const cb = new CircuitBreaker('github', 2, 60000);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await expect(cb.execute(() => 'should not run')).rejects.toThrow(/Circuit breaker OPEN/);
  });

  it('OPEN → HALF_OPEN → CLOSED lifecycle after cooldown + success', async () => {
    const cb = new CircuitBreaker('github', 2, 30); // short cooldown for test
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await new Promise(r => setTimeout(r, 40));
    const result = await cb.execute(() => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('HALF_OPEN → OPEN on failure during probe', async () => {
    const cb = new CircuitBreaker('cli', 2, 30);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});

    await new Promise(r => setTimeout(r, 40));
    // This call transitions to HALF_OPEN then fails → back to OPEN
    await cb.execute(() => { throw new Error('still broken'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('emits correct events on state transitions', async () => {
    const cb = new CircuitBreaker('github', 2, 30);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});

    expect(eventBus.emit).toHaveBeenCalledWith('resilience:circuit-open', expect.objectContaining({
      service: 'github', current: 'OPEN',
    }));

    await new Promise(r => setTimeout(r, 40));
    await cb.execute(() => 'ok');

    expect(eventBus.emit).toHaveBeenCalledWith('resilience:circuit-half-open', expect.objectContaining({
      service: 'github', current: 'HALF_OPEN',
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:circuit-closed', expect.objectContaining({
      service: 'github', current: 'CLOSED',
    }));
  });

  it('reset() restores CLOSED state and clears failure count', async () => {
    const cb = new CircuitBreaker('firebase', 3, 60000);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
    // One more failure should not open (counter reset)
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('CLOSED');
  });

  it('getService() returns service name', () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    expect(cb.getService()).toBe('firebase');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC2: error-budget.js — failure rate in 30min window, max 30%, auto-pause
// ═══════════════════════════════════════════════════════════════════════

describe('QA — AC2: ErrorBudget', () => {
  let budget;

  beforeEach(() => {
    vi.clearAllMocks();
    budget = new ErrorBudget(1800000, 0.3);
  });

  it('getRate() returns 0 when empty', () => {
    expect(budget.getRate()).toBe(0);
  });

  it('tracks failure rate correctly: 3 fail / 10 total = 30%', () => {
    for (let i = 0; i < 7; i++) budget.record(true);
    for (let i = 0; i < 3; i++) budget.record(false);
    expect(budget.getRate()).toBeCloseTo(0.3, 2);
  });

  it('isExhausted() is false at exactly 30% (> not >=)', () => {
    for (let i = 0; i < 7; i++) budget.record(true);
    for (let i = 0; i < 3; i++) budget.record(false);
    // 30% exactly → not exhausted (uses >)
    expect(budget.isExhausted()).toBe(false);
  });

  it('isExhausted() is true above 30%', () => {
    for (let i = 0; i < 6; i++) budget.record(true);
    for (let i = 0; i < 4; i++) budget.record(false);
    // 40% > 30%
    expect(budget.isExhausted()).toBe(true);
  });

  it('emits resilience:auto-pause when budget is exhausted', () => {
    budget.record(false);
    budget.record(false);
    // 100% failure rate
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:auto-pause', expect.objectContaining({
      reason: 'error-budget-exhausted',
    }));
  });

  it('emits resilience:budget-exhausted with rate and maxRate', () => {
    budget.record(false);
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:budget-exhausted', expect.objectContaining({
      rate: 1.0,
      maxRate: 0.3,
    }));
  });

  it('auto-pause emitted only once until recovery', () => {
    budget.record(false);
    budget.record(false);
    budget.record(false);
    const pauseCalls = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:auto-pause');
    expect(pauseCalls).toHaveLength(1);
  });

  it('sliding window prunes entries older than window', async () => {
    const shortBudget = new ErrorBudget(50, 0.3);
    shortBudget.record(false);
    shortBudget.record(false);
    expect(shortBudget.getRate()).toBe(1.0);

    await new Promise(r => setTimeout(r, 60));
    shortBudget.record(true);
    // Old failures pruned, only the new success remains
    expect(shortBudget.getRate()).toBe(0);
    expect(shortBudget.isExhausted()).toBe(false);
  });

  it('reset() clears all entries and resets exhausted flag', () => {
    budget.record(false);
    budget.record(false);
    budget.reset();
    expect(budget.getRate()).toBe(0);
    expect(budget.isExhausted()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC3: dead-letter-queue.js — failed ops queue, exponential retry, max 3
// ═══════════════════════════════════════════════════════════════════════

describe('QA — AC3: DeadLetterQueue', () => {
  let dlq;

  beforeEach(() => {
    vi.clearAllMocks();
    dlq = new DeadLetterQueue(3, 10);
  });

  it('enqueue() stores a failed operation and returns an id', () => {
    const id = dlq.enqueue({ service: 'firebase', operation: 'save', payload: { x: 1 }, error: new Error('timeout') });
    expect(id).toMatch(/^dlq-/);
    expect(dlq.size()).toBe(1);
  });

  it('enqueue() emits resilience:dlq-enqueued', () => {
    dlq.enqueue({ service: 'github', operation: 'push', payload: null, error: new Error('net') });
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-enqueued', expect.objectContaining({
      service: 'github', operation: 'push',
    }));
  });

  it('enqueue() handles string errors', () => {
    dlq.enqueue({ service: 'cli', operation: 'exec', payload: null, error: 'string error' });
    const entry = dlq.getQueue()[0];
    expect(entry.error).toBe('string error');
  });

  it('enqueue() extracts .message from Error objects', () => {
    dlq.enqueue({ service: 'cli', operation: 'exec', payload: null, error: new Error('specific msg') });
    const entry = dlq.getQueue()[0];
    expect(entry.error).toBe('specific msg');
  });

  it('processRetries() resolves entry on successful retry', async () => {
    dlq.enqueue({ service: 'firebase', operation: 'save', payload: null, error: 'err' });
    dlq.getQueue()[0].nextRetryAt = Date.now();

    await dlq.processRetries(async () => 'ok');
    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(0);
  });

  it('processRetries() emits resilience:dlq-retry with attempt number', async () => {
    dlq.enqueue({ service: 'firebase', operation: 'save', payload: null, error: 'err' });
    dlq.getQueue()[0].nextRetryAt = Date.now();

    await dlq.processRetries(async () => { throw new Error('fail'); });
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-retry', expect.objectContaining({ attempt: 1 }));
  });

  it('exponential backoff: nextRetryAt uses baseDelay * 2^attempt', async () => {
    const dlq2 = new DeadLetterQueue(3, 100);
    dlq2.enqueue({ service: 'github', operation: 'push', payload: null, error: 'err' });
    const queue = dlq2.getQueue();
    queue[0].nextRetryAt = Date.now();
    const beforeRetry = Date.now();

    await dlq2.processRetries(async () => { throw new Error('fail'); });

    const entry = dlq2.getQueue()[0];
    // After attempt 1: nextRetryAt ≈ now + 100 * 2^1 = 200ms
    expect(entry.nextRetryAt).toBeGreaterThanOrEqual(beforeRetry + 200 - 10);
  });

  it('max 3 retries: entry becomes permanently-failed after 3 attempts', async () => {
    dlq.enqueue({ service: 'cli', operation: 'run', payload: null, error: 'err' });
    const retryFn = vi.fn().mockRejectedValue(new Error('nope'));

    for (let i = 0; i < 3; i++) {
      const q = dlq.getQueue();
      if (q.length > 0) q[0].nextRetryAt = Date.now();
      await dlq.processRetries(retryFn);
    }

    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(1);
  });

  it('emits resilience:dlq-permanent-fail after max retries', async () => {
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });
    const retryFn = vi.fn().mockRejectedValue(new Error('nope'));

    for (let i = 0; i < 3; i++) {
      const q = dlq.getQueue();
      if (q.length > 0) q[0].nextRetryAt = Date.now();
      await dlq.processRetries(retryFn);
    }

    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-permanent-fail', expect.objectContaining({
      service: 'firebase', operation: 'write', attempts: 3,
    }));
  });

  it('concurrent processRetries() calls are guarded', async () => {
    dlq.enqueue({ service: 'firebase', operation: 'save', payload: null, error: 'err' });
    dlq.getQueue()[0].nextRetryAt = Date.now();

    let callCount = 0;
    const slowRetry = async () => { callCount++; await new Promise(r => setTimeout(r, 30)); throw new Error('f'); };

    await Promise.all([dlq.processRetries(slowRetry), dlq.processRetries(slowRetry)]);
    expect(callCount).toBe(1);
  });

  it('reset() clears all entries', () => {
    dlq.enqueue({ service: 'firebase', operation: 'a', payload: null, error: 'e' });
    dlq.enqueue({ service: 'github', operation: 'b', payload: null, error: 'e' });
    dlq.reset();
    expect(dlq.size()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC4: resilience-manager.js — coordinator principal
// ═══════════════════════════════════════════════════════════════════════

describe('QA — AC4: ResilienceManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ResilienceManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('creates breakers for all configured services', () => {
    const status = manager.getStatus();
    expect(Object.keys(status.breakers).sort()).toEqual(['cli', 'firebase', 'github']);
    expect(Object.values(status.breakers)).toEqual(['CLOSED', 'CLOSED', 'CLOSED']);
  });

  it('execute() returns result on success', async () => {
    const result = await manager.execute('firebase', async () => 42);
    expect(result).toBe(42);
  });

  it('execute() throws for unknown service', async () => {
    await expect(manager.execute('redis', () => 'x')).rejects.toThrow(/Unknown service/);
  });

  it('execute() records success in error budget (rate stays 0)', async () => {
    await manager.execute('firebase', () => 'ok');
    expect(manager.getStatus().errorBudgetRate).toBe(0);
  });

  it('execute() records failure in error budget and DLQ on error', async () => {
    await manager.execute('github', () => { throw new Error('down'); }).catch(() => {});
    const status = manager.getStatus();
    expect(status.errorBudgetRate).toBe(1.0);
    expect(status.dlqSize).toBe(1);
  });

  it('circuit breaker opens after per-service threshold failures via manager', async () => {
    // github threshold = 3
    for (let i = 0; i < 3; i++) {
      await manager.execute('github', () => { throw new Error('f'); }).catch(() => {});
    }
    expect(manager.getStatus().breakers.github).toBe('OPEN');
    // firebase should still be CLOSED
    expect(manager.getStatus().breakers.firebase).toBe('CLOSED');
  });

  it('initialize() emits resilience:initialized with service list', () => {
    manager.initialize();
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:initialized', expect.objectContaining({
      services: expect.arrayContaining(['firebase', 'github', 'cli']),
    }));
  });

  it('initialize() is idempotent — second call is noop', () => {
    manager.initialize();
    manager.initialize();
    const initCalls = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:initialized');
    expect(initCalls).toHaveLength(1);
  });

  it('shutdown() clears interval and resets initialized flag', () => {
    manager.initialize();
    expect(manager.initialized).toBe(true);
    manager.shutdown();
    expect(manager.initialized).toBe(false);
  });

  it('getBreaker() returns the breaker for a service', () => {
    const breaker = manager.getBreaker('cli');
    expect(breaker).toBeDefined();
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('getBreaker() returns undefined for unknown service', () => {
    expect(manager.getBreaker('redis')).toBeUndefined();
  });

  it('getStatus() has all required fields', () => {
    const status = manager.getStatus();
    expect(status).toHaveProperty('breakers');
    expect(status).toHaveProperty('errorBudgetRate');
    expect(status).toHaveProperty('errorBudgetExhausted');
    expect(status).toHaveProperty('dlqSize');
    expect(status).toHaveProperty('dlqPermanentlyFailed');
  });

  it('shutdown without initialize does not throw', () => {
    const m = new ResilienceManager();
    expect(() => m.shutdown()).not.toThrow();
  });
});
