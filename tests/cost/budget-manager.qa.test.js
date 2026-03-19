import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockOnce = vi.fn();
const mockRef = vi.fn(() => ({
  once: mockOnce,
  set: mockSet,
}));

vi.mock('../../src/firebase.js', () => ({
  getDb: () => ({ ref: mockRef }),
}));

// Mock event bus
const mockEmit = vi.fn();
vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: mockEmit },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock config with writable values
const mockConfig = {
  dailyBudgetUsd: 10,
  weeklyBudgetUsd: 50,
  budgetWarningThreshold: 0.8,
};

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
}));

// Import after mocks
const { BudgetManager } = await import('../../src/cost/budget-manager.js');

// Helper: create initialized manager
async function createManager(projectId = 'qa-project', firebaseData = null) {
  const manager = new BudgetManager();
  mockOnce.mockResolvedValue({ val: () => firebaseData });
  await manager.initialize(projectId);
  vi.clearAllMocks();
  return manager;
}

// =============================================================================
// QA TESTS — Acceptance Criteria + Edge Cases
// =============================================================================

describe('QA: BudgetManager — Acceptance Criteria', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.dailyBudgetUsd = 10;
    mockConfig.weeklyBudgetUsd = 50;
    mockConfig.budgetWarningThreshold = 0.8;
  });

  // =========================================================================
  // AC1: Initialize desde Firebase, reset daily/weekly
  // =========================================================================
  describe('AC1: Initialize from Firebase with daily/weekly reset', () => {
    it('should restore daily spent from Firebase when date matches today', async () => {
      const today = new Date().toISOString().split('T')[0];
      const manager = new BudgetManager();
      mockOnce.mockResolvedValue({
        val: () => ({
          daily: { date: today, spent: 5.25 },
          weekly: { weekStart: today, spent: 20.0 },
        }),
      });

      await manager.initialize('qa-project');

      expect(manager.getStatus().daily.spent).toBe(5.25);
      expect(manager.initialized).toBe(true);
    });

    it('should reset daily spent to 0 when stored date is stale', async () => {
      const manager = new BudgetManager();
      mockOnce.mockResolvedValue({
        val: () => ({
          daily: { date: '2024-01-01', spent: 8.0 },
          weekly: { weekStart: '2024-01-01', spent: 30.0 },
        }),
      });

      await manager.initialize('qa-project');

      expect(manager.getStatus().daily.spent).toBe(0);
    });

    it('should reset weekly spent to 0 when weekStart is stale', async () => {
      const manager = new BudgetManager();
      mockOnce.mockResolvedValue({
        val: () => ({
          daily: { date: '2024-01-01', spent: 3.0 },
          weekly: { weekStart: '2024-01-01', spent: 45.0 },
        }),
      });

      await manager.initialize('qa-project');

      expect(manager.getStatus().weekly.spent).toBe(0);
    });

    it('should persist reset state to Firebase after initialization', async () => {
      const manager = new BudgetManager();
      mockOnce.mockResolvedValue({ val: () => null });

      await manager.initialize('qa-project');

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          daily: expect.objectContaining({ spent: 0 }),
          weekly: expect.objectContaining({ spent: 0 }),
        }),
      );
    });

    it('should read from the correct Firebase path', async () => {
      const manager = new BudgetManager();
      mockOnce.mockResolvedValue({ val: () => null });

      await manager.initialize('my-special-project');

      expect(mockRef).toHaveBeenCalledWith('budgets/my-special-project');
    });
  });

  // =========================================================================
  // AC2: addCost(), isExceeded()
  // =========================================================================
  describe('AC2: addCost() and isExceeded()', () => {
    it('should add cost and reflect in both daily and weekly', async () => {
      const manager = await createManager();

      await manager.addCost(4.0);

      const status = manager.getStatus();
      expect(status.daily.spent).toBe(4.0);
      expect(status.weekly.spent).toBe(4.0);
    });

    it('should return isExceeded=false when under both limits', async () => {
      const manager = await createManager();

      await manager.addCost(5.0);

      expect(manager.isExceeded()).toBe(false);
    });

    it('should return isExceeded=true when daily limit is exactly reached', async () => {
      const manager = await createManager();

      await manager.addCost(10.0);

      expect(manager.isExceeded()).toBe(true);
    });

    it('should return isExceeded=true when daily limit is exceeded', async () => {
      const manager = await createManager();

      await manager.addCost(12.0);

      expect(manager.isExceeded()).toBe(true);
    });

    it('should return isExceeded=true when weekly limit is reached', async () => {
      mockConfig.dailyBudgetUsd = 100;
      const manager = await createManager();

      await manager.addCost(50.0);

      expect(manager.isExceeded()).toBe(true);
    });

    it('should accumulate costs across multiple addCost calls', async () => {
      const manager = await createManager();

      await manager.addCost(1.0);
      await manager.addCost(2.0);
      await manager.addCost(3.0);

      expect(manager.getStatus().daily.spent).toBe(6.0);
      expect(manager.getStatus().weekly.spent).toBe(6.0);
    });
  });

  // =========================================================================
  // AC3: Warning at 80% threshold configurable
  // =========================================================================
  describe('AC3: Warning at configurable threshold', () => {
    it('should emit warning at default 80% threshold', async () => {
      const manager = await createManager();

      await manager.addCost(8.0); // 80% of $10

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'daily', spent: 8.0, limit: 10 }),
      );
    });

    it('should respect custom threshold (e.g., 0.5 = 50%)', async () => {
      mockConfig.budgetWarningThreshold = 0.5;
      const manager = await createManager();

      await manager.addCost(5.0); // 50% of $10

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'daily', spent: 5.0, limit: 10 }),
      );
    });

    it('should NOT emit warning below threshold', async () => {
      const manager = await createManager();

      await manager.addCost(7.9); // just below 80% of $10

      const warningCalls = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning');
      expect(warningCalls).toHaveLength(0);
    });

    it('should respect custom threshold of 0.9 (90%)', async () => {
      mockConfig.budgetWarningThreshold = 0.9;
      const manager = await createManager();

      await manager.addCost(8.5); // 85% — below 90%

      const warningCalls = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning');
      expect(warningCalls).toHaveLength(0);

      await manager.addCost(0.5); // now 90%

      const warningCallsAfter = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning');
      expect(warningCallsAfter).toHaveLength(1);
    });
  });

  // =========================================================================
  // AC4: Persist to Firebase
  // =========================================================================
  describe('AC4: Persist to Firebase', () => {
    it('should call Firebase set on addCost', async () => {
      const manager = await createManager();

      await manager.addCost(2.5);

      expect(mockSet).toHaveBeenCalled();
      expect(mockRef).toHaveBeenCalledWith('budgets/qa-project');
    });

    it('should persist correct data structure', async () => {
      const manager = await createManager();

      await manager.addCost(3.0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          daily: expect.objectContaining({ spent: 3.0 }),
          weekly: expect.objectContaining({ spent: 3.0 }),
        }),
      );
    });

    it('should persist on every addCost call', async () => {
      const manager = await createManager();

      await manager.addCost(1.0);
      await manager.addCost(2.0);
      await manager.addCost(3.0);

      expect(mockSet).toHaveBeenCalledTimes(3);
    });

    it('should handle Firebase persist failure gracefully', async () => {
      const manager = await createManager();
      mockSet.mockRejectedValueOnce(new Error('Firebase write error'));

      // Should not throw
      await expect(manager.addCost(1.0)).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // AC5: Emits BUDGET_WARNING, BUDGET_EXCEEDED events
  // =========================================================================
  describe('AC5: Emits budget:warning and budget:exceeded events', () => {
    it('should emit budget:warning for daily threshold', async () => {
      const manager = await createManager();

      await manager.addCost(8.0);

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'daily', spent: 8.0, limit: 10 }),
      );
    });

    it('should emit budget:warning for weekly threshold', async () => {
      const manager = await createManager();

      await manager.addCost(40.0); // 80% of $50

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'weekly', spent: 40.0, limit: 50 }),
      );
    });

    it('should emit budget:exceeded when daily limit is reached', async () => {
      const manager = await createManager();

      await manager.addCost(10.0);

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:exceeded',
        expect.objectContaining({ type: 'daily', spent: 10.0, limit: 10 }),
      );
    });

    it('should emit budget:exceeded when weekly limit is reached', async () => {
      mockConfig.dailyBudgetUsd = 100;
      const manager = await createManager();

      await manager.addCost(50.0);

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:exceeded',
        expect.objectContaining({ type: 'weekly', spent: 50.0, limit: 50 }),
      );
    });

    it('should emit exceeded only once per period', async () => {
      const manager = await createManager();

      await manager.addCost(10.0);
      await manager.addCost(1.0);

      const exceededCalls = mockEmit.mock.calls.filter(
        c => c[0] === 'budget:exceeded' && c[1].type === 'daily',
      );
      expect(exceededCalls).toHaveLength(1);
    });

    it('should emit warning only once per period', async () => {
      const manager = await createManager();

      await manager.addCost(8.0);
      await manager.addCost(0.5);

      const warningCalls = mockEmit.mock.calls.filter(
        c => c[0] === 'budget:warning' && c[1].type === 'daily',
      );
      expect(warningCalls).toHaveLength(1);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    it('should ignore zero amount in addCost', async () => {
      const manager = await createManager();

      await manager.addCost(0);

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should ignore negative amount in addCost', async () => {
      const manager = await createManager();

      await manager.addCost(-5);

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should ignore NaN in addCost', async () => {
      const manager = await createManager();

      await manager.addCost(NaN);

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should ignore undefined in addCost', async () => {
      const manager = await createManager();

      await manager.addCost(undefined);

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should ignore null in addCost', async () => {
      const manager = await createManager();

      await manager.addCost(null);

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should handle very small fractional costs', async () => {
      const manager = await createManager();

      await manager.addCost(0.001);

      expect(manager.getStatus().daily.spent).toBeCloseTo(0.001);
    });

    it('should handle very large costs', async () => {
      const manager = await createManager();

      await manager.addCost(99999.99);

      expect(manager.getStatus().daily.spent).toBe(99999.99);
      expect(manager.isExceeded()).toBe(true);
    });

    it('should not be initialized before calling initialize()', () => {
      const manager = new BudgetManager();
      expect(manager.initialized).toBe(false);
    });

    it('should return correct remaining when spent exceeds limit', async () => {
      const manager = await createManager();

      await manager.addCost(15.0); // over $10 daily

      const status = manager.getStatus();
      expect(status.daily.remaining).toBe(0); // clamped to 0
      expect(status.daily.percentage).toBeGreaterThan(1);
    });

    it('should handle re-initialization', async () => {
      const manager = await createManager();
      await manager.addCost(5.0);

      // Re-initialize with fresh data
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('qa-project');

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(manager.initialized).toBe(true);
    });

    it('getStatus should return consistent structure with zero budget', async () => {
      mockConfig.dailyBudgetUsd = 0;
      mockConfig.weeklyBudgetUsd = 0;
      const manager = await createManager();

      const status = manager.getStatus();

      expect(status.daily.percentage).toBe(0);
      expect(status.weekly.percentage).toBe(0);
      expect(status.daily.remaining).toBe(0);
    });
  });
});
