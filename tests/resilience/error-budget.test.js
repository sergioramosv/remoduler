import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    resilienceErrorBudgetWindowMs: 1800000,
    resilienceErrorBudgetMaxRate: 0.3,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() },
}));

const { ErrorBudget } = await import('../../src/resilience/error-budget.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('ErrorBudget — Acceptance Criteria', () => {
  let budget;

  beforeEach(() => {
    vi.clearAllMocks();
    budget = new ErrorBudget(1800000, 0.3);
  });

  it('AC2: tracks failure rate in 30min window', () => {
    // 7 successes, 3 failures = 30% rate
    for (let i = 0; i < 7; i++) budget.record(true);
    for (let i = 0; i < 3; i++) budget.record(false);

    expect(budget.getRate()).toBeCloseTo(0.3, 2);
  });

  it('AC2: max 30% — triggers auto-pause when exceeded', () => {
    // 6 successes, 4 failures = 40% rate (> 30%)
    for (let i = 0; i < 6; i++) budget.record(true);
    for (let i = 0; i < 4; i++) budget.record(false);

    expect(budget.isExhausted()).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:budget-exhausted', expect.objectContaining({
      maxRate: 0.3,
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('resilience:auto-pause', expect.objectContaining({
      reason: 'error-budget-exhausted',
    }));
  });

  it('AC2: does not trigger auto-pause at exactly 30% or below', () => {
    // 7 successes, 3 failures = 30% exactly (not > 30%)
    for (let i = 0; i < 7; i++) budget.record(true);
    for (let i = 0; i < 3; i++) budget.record(false);

    expect(budget.isExhausted()).toBe(false);
    expect(eventBus.emit).not.toHaveBeenCalledWith('resilience:auto-pause', expect.anything());
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('ErrorBudget — Unit', () => {
  let budget;

  beforeEach(() => {
    vi.clearAllMocks();
    budget = new ErrorBudget(1800000, 0.3);
  });

  it('getRate() returns 0 with no entries', () => {
    expect(budget.getRate()).toBe(0);
  });

  it('getRate() returns correct rate after mixed entries', () => {
    budget.record(true);
    budget.record(false);
    expect(budget.getRate()).toBeCloseTo(0.5, 2);
  });

  it('isExhausted() returns false when rate is within budget', () => {
    budget.record(true);
    budget.record(true);
    budget.record(true);
    budget.record(false);
    // 1/4 = 25% < 30%
    expect(budget.isExhausted()).toBe(false);
  });

  it('reset() clears all entries', () => {
    budget.record(false);
    budget.record(false);
    budget.reset();
    expect(budget.getRate()).toBe(0);
    expect(budget.isExhausted()).toBe(false);
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('ErrorBudget — Edge Cases', () => {
  it('sliding window prunes old entries', () => {
    // Use tiny window
    const budget = new ErrorBudget(50, 0.3);

    // Record failures
    budget.record(false);
    budget.record(false);
    expect(budget.getRate()).toBe(1.0);

    // Wait for window to expire, then add successes
    return new Promise(resolve => {
      setTimeout(() => {
        budget.record(true);
        // Old failures should be pruned, only the success remains
        expect(budget.getRate()).toBe(0);
        resolve();
      }, 60);
    });
  });

  it('emits auto-pause only once until rate recovers', () => {
    vi.clearAllMocks();
    const budget = new ErrorBudget(1800000, 0.3);

    // Push past 30%
    budget.record(false);
    budget.record(false);
    // Rate is 100%, should emit once

    const pauseCalls = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:auto-pause');
    expect(pauseCalls.length).toBe(1);

    // Record another failure — should NOT emit again
    budget.record(false);
    const pauseCallsAfter = eventBus.emit.mock.calls.filter(c => c[0] === 'resilience:auto-pause');
    expect(pauseCallsAfter.length).toBe(1);
  });
});
