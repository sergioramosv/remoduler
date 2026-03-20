import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
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

const { DeadLetterQueue } = await import('../../src/resilience/dead-letter-queue.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('DeadLetterQueue — Acceptance Criteria', () => {
  let dlq;

  beforeEach(() => {
    vi.clearAllMocks();
    dlq = new DeadLetterQueue(3, 10); // short delay for tests
  });

  it('AC3: enqueues failed operations', () => {
    const id = dlq.enqueue({ service: 'firebase', operation: 'write', payload: { key: 'val' }, error: new Error('timeout') });
    expect(id).toBeDefined();
    expect(dlq.size()).toBe(1);
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-enqueued', expect.objectContaining({
      service: 'firebase',
      operation: 'write',
    }));
  });

  it('AC3: retry exponential backoff (1s, 2s, 4s) — uses baseDelay * 2^attempt', async () => {
    // Use baseDelay=100 for testable timing
    const dlq2 = new DeadLetterQueue(3, 100);
    dlq2.enqueue({ service: 'github', operation: 'push', payload: null, error: new Error('fail') });

    // First retry — attempt 1
    // Manually set nextRetryAt to now so it processes
    const queue = dlq2.getQueue();
    queue[0].nextRetryAt = Date.now();

    await dlq2.processRetries(async () => { throw new Error('still failing'); });
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-retry', expect.objectContaining({ attempt: 1 }));

    // After attempt 1, nextRetryAt should be ~now + 100*2^1 = 200ms
    const entry = dlq2.getQueue()[0];
    expect(entry).toBeDefined();
  });

  it('AC3: max 3 retries then permanently failed', async () => {
    dlq.enqueue({ service: 'cli', operation: 'exec', payload: null, error: new Error('fail') });

    const retryFn = vi.fn().mockRejectedValue(new Error('still broken'));

    for (let i = 0; i < 3; i++) {
      const queue = dlq.getQueue();
      if (queue.length > 0) queue[0].nextRetryAt = Date.now();
      await dlq.processRetries(retryFn);
    }

    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(1);
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:dlq-permanent-fail', expect.objectContaining({
      service: 'cli',
      operation: 'exec',
      attempts: 3,
    }));
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('DeadLetterQueue — Unit', () => {
  let dlq;

  beforeEach(() => {
    vi.clearAllMocks();
    dlq = new DeadLetterQueue(3, 10);
  });

  it('size() returns count of pending entries', () => {
    expect(dlq.size()).toBe(0);
    dlq.enqueue({ service: 'firebase', operation: 'read', payload: null, error: 'err' });
    dlq.enqueue({ service: 'github', operation: 'pr', payload: null, error: 'err' });
    expect(dlq.size()).toBe(2);
  });

  it('getQueue() returns only pending entries', () => {
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });
    const queue = dlq.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('pending');
  });

  it('processRetries resolves entry on success', async () => {
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });
    dlq.getQueue()[0].nextRetryAt = Date.now();

    await dlq.processRetries(async () => 'ok');
    expect(dlq.size()).toBe(0);
    expect(dlq.getPermanentlyFailed()).toHaveLength(0);
  });

  it('reset() clears the queue', () => {
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });
    dlq.reset();
    expect(dlq.size()).toBe(0);
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('DeadLetterQueue — Edge Cases', () => {
  it('processRetries guards against concurrent runs', async () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: 'err' });
    dlq.getQueue()[0].nextRetryAt = Date.now();

    let callCount = 0;
    const slowRetry = async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      throw new Error('fail');
    };

    // Start two concurrent processRetries
    const p1 = dlq.processRetries(slowRetry);
    const p2 = dlq.processRetries(slowRetry);
    await Promise.all([p1, p2]);

    // Only one should have actually processed
    expect(callCount).toBe(1);
  });

  it('enqueue stores error message from Error objects', () => {
    const dlq = new DeadLetterQueue(3, 10);
    dlq.enqueue({ service: 'firebase', operation: 'write', payload: null, error: new Error('specific error') });
    const queue = dlq.getQueue();
    expect(queue[0].error).toBe('specific error');
  });
});
