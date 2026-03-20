import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    resilienceThresholds: { firebase: 5, github: 3, cli: 4 },
    resilienceCooldownMs: 60000,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() },
}));

const { CircuitBreaker, CIRCUIT_STATES } = await import('../../src/resilience/circuit-breaker.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('CircuitBreaker — Acceptance Criteria', () => {
  let breaker;

  beforeEach(() => {
    vi.clearAllMocks();
    breaker = new CircuitBreaker('firebase', 5, 60000);
  });

  it('AC1: exports CLOSED, OPEN, HALF_OPEN states', () => {
    expect(CIRCUIT_STATES).toEqual({
      CLOSED: 'CLOSED',
      OPEN: 'OPEN',
      HALF_OPEN: 'HALF_OPEN',
    });
  });

  it('AC1: starts in CLOSED state', () => {
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('AC1: per-service thresholds — firebase=5, github=3, cli=4', () => {
    const fb = new CircuitBreaker('firebase', 5, 60000);
    const gh = new CircuitBreaker('github', 3, 60000);
    const cli = new CircuitBreaker('cli', 4, 60000);

    // Firebase needs 5 failures to open
    for (let i = 0; i < 4; i++) {
      fb.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(fb.getState()).toBe('CLOSED');
    fb.execute(() => { throw new Error('fail'); }).catch(() => {});
    expect(fb.getState()).toBe('OPEN');

    // GitHub needs 3 failures to open
    for (let i = 0; i < 3; i++) {
      gh.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(gh.getState()).toBe('OPEN');

    // CLI needs 4 failures to open
    for (let i = 0; i < 3; i++) {
      cli.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cli.getState()).toBe('CLOSED');
    cli.execute(() => { throw new Error('fail'); }).catch(() => {});
    expect(cli.getState()).toBe('OPEN');
  });

  it('AC1: cooldown 60s — rejects calls while OPEN, transitions to HALF_OPEN after cooldown', async () => {
    // Use a short cooldown for test
    const cb = new CircuitBreaker('github', 2, 50);

    // Open the breaker
    await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    await cb.execute(() => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    // Should reject while OPEN
    await expect(cb.execute(() => 'ok')).rejects.toThrow('Circuit breaker OPEN');

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 60));

    // Next call should transition to HALF_OPEN and succeed
    const result = await cb.execute(() => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('CircuitBreaker — Unit', () => {
  let breaker;

  beforeEach(() => {
    vi.clearAllMocks();
    breaker = new CircuitBreaker('github', 3, 60000);
  });

  it('execute() returns result on success', async () => {
    const result = await breaker.execute(() => 42);
    expect(result).toBe(42);
  });

  it('execute() throws on failure and counts failures', async () => {
    await expect(breaker.execute(() => { throw new Error('oops'); })).rejects.toThrow('oops');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('emits resilience:circuit-open on threshold reached', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => { throw new Error('fail'); }).catch(() => {});
    }
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:circuit-open', expect.objectContaining({
      service: 'github',
      current: 'OPEN',
    }));
  });

  it('emits resilience:circuit-closed on recovery', async () => {
    const cb = new CircuitBreaker('github', 2, 50);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});

    await new Promise(r => setTimeout(r, 60));
    await cb.execute(() => 'ok');

    expect(eventBus.emit).toHaveBeenCalledWith('resilience:circuit-closed', expect.objectContaining({
      service: 'github',
      current: 'CLOSED',
    }));
  });

  it('reset() returns to CLOSED with 0 failures', async () => {
    await breaker.execute(() => { throw new Error('f'); }).catch(() => {});
    await breaker.execute(() => { throw new Error('f'); }).catch(() => {});
    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');
    // Should not open after 1 more failure (counter was reset)
    await breaker.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(breaker.getState()).toBe('CLOSED');
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('CircuitBreaker — Edge Cases', () => {
  it('HALF_OPEN re-opens on failure', async () => {
    const cb = new CircuitBreaker('cli', 2, 50);
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    await cb.execute(() => { throw new Error('f'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await new Promise(r => setTimeout(r, 60));

    // Fail in HALF_OPEN → goes back to OPEN
    await cb.execute(() => { throw new Error('still broken'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('supports async functions', async () => {
    const cb = new CircuitBreaker('firebase', 5, 60000);
    const result = await cb.execute(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'async-result';
    });
    expect(result).toBe('async-result');
  });
});
