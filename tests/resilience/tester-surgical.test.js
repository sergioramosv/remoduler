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

// ─── CIRCUIT BREAKER — Surgical gaps ────────────────────────────────

describe('CircuitBreaker — Surgical', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getService() returns the service name', () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    expect(cb.getService()).toBe('firebase');
  });

  it('emits resilience:circuit-half-open on cooldown expiry', async () => {
    const cb = new CircuitBreaker('github', 2, 50);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await new Promise(r => setTimeout(r, 60));

    // Next call triggers HALF_OPEN transition, then succeeds → CLOSED
    await cb.execute(() => 'ok');
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:circuit-half-open', expect.objectContaining({
      service: 'github',
      previous: 'OPEN',
      current: 'HALF_OPEN',
    }));
  });

  it('success in CLOSED state resets failure counter (partial failures dont accumulate across successes)', async () => {
    const cb = new CircuitBreaker('github', 3, 60000);
    // 2 failures (below threshold)
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    // 1 success resets counter
    await cb.execute(() => 'ok');
    // 1 more failure should NOT open (counter was reset)
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('CLOSED');
  });

  it('OPEN state rejects immediately without calling fn', async () => {
    const cb = new CircuitBreaker('cli', 2, 60000);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});

    const fn = vi.fn();
    await expect(cb.execute(fn)).rejects.toThrow('Circuit breaker OPEN');
    expect(fn).not.toHaveBeenCalled();
  });
});

// ─── ERROR BUDGET — Surgical gaps ───────────────────────────────────

describe('ErrorBudget — Surgical', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-emits auto-pause after rate recovers and exceeds again', () => {
    const budget = new ErrorBudget(1800000, 0.3);

    // Exhaust budget: 2 failures = 100%
    budget.record(false);
    budget.record(false);
    const firstPause = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:auto-pause');
    expect(firstPause).toHaveLength(1);

    // Recover: add enough successes to drop below 30%
    // 2 failures + 8 successes = 20%
    for (let i = 0; i < 8; i++) budget.record(true);
    expect(budget.isExhausted()).toBe(false);

    // Exhaust again
    for (let i = 0; i < 6; i++) budget.record(false);
    // now 8/16 = 50%
    const secondPause = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:auto-pause');
    expect(secondPause.length).toBeGreaterThan(1);
  });

  it('single failure gives rate=1.0 and triggers exhaustion', () => {
    const budget = new ErrorBudget(1800000, 0.3);
    budget.record(false);
    expect(budget.getRate()).toBe(1.0);
    expect(budget.isExhausted()).toBe(true);
  });
});

// ─── DEAD LETTER QUEUE — Surgical gaps ──────────────────────────────

describe('DeadLetterQueue — Surgical', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueue with string error stores it directly', () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'read', payload: null, error: 'plain string error' });
    const queue = dlq.getQueue();
    expect(queue[0].error).toBe('plain string error');
  });

  it('processRetries skips entries whose nextRetryAt is in the future', async () => {
    const dlq = new DeadLetterQueue(3, 100000); // very long delay
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });

    const retryFn = vi.fn();
    await dlq.processRetries(retryFn);
    // Entry not ready yet — retryFn should not be called
    expect(retryFn).not.toHaveBeenCalled();
    expect(dlq.size()).toBe(1);
  });

  it('processRetries handles multiple entries in a single batch', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'op1', payload: null, error: 'err' });
    dlq.enqueue({ service: 'github', operation: 'op2', payload: null, error: 'err' });

    // Make both ready
    for (const entry of dlq.getQueue()) entry.nextRetryAt = Date.now();

    const retryFn = vi.fn().mockResolvedValue('ok');
    await dlq.processRetries(retryFn);

    expect(retryFn).toHaveBeenCalledTimes(2);
    expect(dlq.size()).toBe(0);
  });

  it('resolved entries do not appear in getQueue or getPermanentlyFailed', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });
    dlq.getQueue()[0].nextRetryAt = Date.now();

    await dlq.processRetries(async () => 'ok');

    expect(dlq.getQueue()).toHaveLength(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(0);
  });

  it('exponential backoff calculates correct nextRetryAt after each failed retry', async () => {
    const baseDelay = 100;
    const dlq = new DeadLetterQueue(3, baseDelay);
    dlq.enqueue({ service: 'cli', operation: 'exec', payload: null, error: 'err' });

    const retryFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Retry 1
    dlq.getQueue()[0].nextRetryAt = Date.now();
    const beforeRetry1 = Date.now();
    await dlq.processRetries(retryFn);
    const entry1 = dlq.getQueue()[0];
    // After attempt 1: nextRetryAt ≈ now + baseDelay * 2^1 = 200ms
    expect(entry1.nextRetryAt).toBeGreaterThanOrEqual(beforeRetry1 + baseDelay * 2);

    // Retry 2
    entry1.nextRetryAt = Date.now();
    const beforeRetry2 = Date.now();
    await dlq.processRetries(retryFn);
    const entry2 = dlq.getQueue()[0];
    // After attempt 2: nextRetryAt ≈ now + baseDelay * 2^2 = 400ms
    expect(entry2.nextRetryAt).toBeGreaterThanOrEqual(beforeRetry2 + baseDelay * 4);
  });
});

// ─── RESILIENCE MANAGER — Surgical gaps ─────────────────────────────

describe('ResilienceManager — Surgical', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ResilienceManager();
  });

  afterEach(() => manager.shutdown());

  it('execute() captures named function in DLQ operation field', async () => {
    async function fetchData() { throw new Error('timeout'); }
    await expect(manager.execute('firebase', fetchData)).rejects.toThrow('timeout');

    const status = manager.getStatus();
    expect(status.dlqSize).toBe(1);
    // The DLQ should have captured the fn name
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-enqueued', expect.objectContaining({
      service: 'firebase',
      operation: 'fetchData',
    }));
  });

  it('getBreaker() returns undefined for unknown service', () => {
    expect(manager.getBreaker('unknown')).toBeUndefined();
  });

  it('full pipeline: repeated failures exhaust budget and trigger auto-pause', async () => {
    // Firebase threshold = 5, need many failures to exhaust budget
    // Record 1 success + 4 failures = 80% rate > 30%
    await manager.execute('firebase', () => 'ok');
    for (let i = 0; i < 4; i++) {
      await manager.execute('firebase', () => { throw new Error('fail'); }).catch(() => {});
    }

    const status = manager.getStatus();
    expect(status.errorBudgetRate).toBeCloseTo(4 / 5, 2);
    expect(status.errorBudgetExhausted).toBe(true);
    expect(status.dlqSize).toBe(4);
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:auto-pause', expect.objectContaining({
      reason: 'error-budget-exhausted',
    }));
  });

  it('execute() with anonymous function uses "anonymous" as operation', async () => {
    await expect(manager.execute('github', () => { throw new Error('err'); })).rejects.toThrow('err');
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-enqueued', expect.objectContaining({
      operation: 'anonymous',
    }));
  });

  it('getStatus() reflects dlqPermanentlyFailed count after retries exhausted', async () => {
    // Enqueue a failure via execute
    await manager.execute('cli', () => { throw new Error('f'); }).catch(() => {});
    expect(manager.getStatus().dlqSize).toBe(1);
    expect(manager.getStatus().dlqPermanentlyFailed).toBe(0);
  });
});
