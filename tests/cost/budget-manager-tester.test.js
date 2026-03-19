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
const { BudgetManager, budgetManager } = await import('../../src/cost/budget-manager.js');

describe('BudgetManager — Tester surgical tests', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BudgetManager();
    mockConfig.dailyBudgetUsd = 10;
    mockConfig.weeklyBudgetUsd = 50;
    mockConfig.budgetWarningThreshold = 0.8;
  });

  // ─── AC: Singleton export ───
  describe('singleton export', () => {
    it('should export a budgetManager singleton instance', () => {
      expect(budgetManager).toBeInstanceOf(BudgetManager);
    });
  });

  // ─── AC: Configurable warning threshold ───
  describe('configurable warning threshold', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should emit warning at custom 50% threshold', async () => {
      mockConfig.budgetWarningThreshold = 0.5;

      await manager.addCost(5.0); // 50% of $10

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'daily', spent: 5.0, threshold: 0.5 }),
      );
    });

    it('should emit warning at custom 90% threshold', async () => {
      mockConfig.budgetWarningThreshold = 0.9;

      await manager.addCost(8.0); // 80% — should NOT warn at 90% threshold
      const warningCalls = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning');
      expect(warningCalls).toHaveLength(0);

      await manager.addCost(1.0); // 90% — NOW should warn
      const warningCalls2 = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning');
      expect(warningCalls2).toHaveLength(1);
    });
  });

  // ─── AC: Daily reset independent of weekly ───
  describe('daily/weekly reset independence', () => {
    it('should reset daily but keep weekly when only day changed within same week', async () => {
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diff);
      const weekStart = monday.toISOString().split('T')[0];

      mockOnce.mockResolvedValue({
        val: () => ({
          daily: { date: '2020-01-01', spent: 5.0 }, // old date → reset
          weekly: { weekStart, spent: 25.0 },          // current week → keep
        }),
      });

      await manager.initialize('test-project');

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(manager.getStatus().weekly.spent).toBe(25.0);
    });
  });

  // ─── Risk: Firebase persist failure resilience ───
  describe('persist failure resilience', () => {
    it('should not crash addCost when Firebase set fails', async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();

      mockSet.mockRejectedValueOnce(new Error('write failed'));

      // Should not throw
      await expect(manager.addCost(2.0)).resolves.not.toThrow();
      // State should still be updated in-memory
      expect(manager.getStatus().daily.spent).toBe(2.0);
    });
  });

  // ─── Edge: exceeded emits before warning when jumping past both ───
  describe('exceeded before warning edge case', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should emit exceeded (not warning) when single cost jumps past both thresholds', async () => {
      await manager.addCost(10.0); // 100% in one shot, past 80% warning AND 100% exceeded

      const exceeded = mockEmit.mock.calls.filter(c => c[0] === 'budget:exceeded' && c[1].type === 'daily');
      const warnings = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning' && c[1].type === 'daily');

      expect(exceeded).toHaveLength(1);
      // Warning should NOT fire because exceeded takes precedence (if/else structure)
      expect(warnings).toHaveLength(0);
    });
  });

  // ─── Edge: addCost with null/undefined ───
  describe('addCost edge inputs', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should ignore null amount', async () => {
      await manager.addCost(null);
      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should ignore undefined amount', async () => {
      await manager.addCost(undefined);
      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  // ─── AC: Re-initialization resets warning/exceeded flags ───
  describe('re-initialization resets event flags', () => {
    it('should re-emit warnings after re-initialize', async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');

      await manager.addCost(8.0); // trigger warning
      expect(mockEmit).toHaveBeenCalledWith('budget:warning', expect.objectContaining({ type: 'daily' }));
      vi.clearAllMocks();

      // Re-initialize (simulating new day or manual re-init)
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');

      await manager.addCost(8.0); // should warn again because flags reset
      expect(mockEmit).toHaveBeenCalledWith('budget:warning', expect.objectContaining({ type: 'daily' }));
    });
  });

  // ─── AC: isExceeded boundary — exact limit ───
  describe('isExceeded boundary precision', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should return true at exactly the daily limit (>=)', async () => {
      await manager.addCost(10.0); // exactly $10
      expect(manager.isExceeded()).toBe(true);
    });

    it('should return false just below daily limit', async () => {
      await manager.addCost(9.99);
      expect(manager.isExceeded()).toBe(false);
    });

    it('should return true when only weekly exceeded (daily under)', async () => {
      mockConfig.dailyBudgetUsd = 100; // raise daily out of the way
      mockConfig.weeklyBudgetUsd = 5;
      await manager.addCost(5.0);
      expect(manager.isExceeded()).toBe(true);
    });
  });

  // ─── AC: getStatus remaining never negative ───
  describe('getStatus remaining clamped at 0', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should clamp remaining to 0 when overspent', async () => {
      await manager.addCost(15.0); // $15 > $10 limit

      const status = manager.getStatus();
      expect(status.daily.remaining).toBe(0);
      expect(status.daily.percentage).toBeCloseTo(1.5);
    });
  });

  // ─── Risk: Initialize persists initial state to Firebase ───
  describe('initialize persists to Firebase', () => {
    it('should persist state after initialization', async () => {
      mockOnce.mockResolvedValue({ val: () => null });

      await manager.initialize('my-project');

      expect(mockRef).toHaveBeenCalledWith('budgets/my-project');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          daily: expect.objectContaining({ spent: 0 }),
          weekly: expect.objectContaining({ spent: 0 }),
        }),
      );
    });
  });

  // ─── AC: Exceeded event includes correct data payload ───
  describe('event payloads', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('budget:exceeded event should include type, spent, and limit', async () => {
      await manager.addCost(10.0);

      const call = mockEmit.mock.calls.find(c => c[0] === 'budget:exceeded');
      expect(call).toBeDefined();
      expect(call[1]).toEqual({
        type: 'daily',
        spent: 10.0,
        limit: 10,
      });
    });

    it('budget:warning event should include type, spent, limit, and threshold', async () => {
      await manager.addCost(8.0);

      const call = mockEmit.mock.calls.find(c => c[0] === 'budget:warning');
      expect(call).toBeDefined();
      expect(call[1]).toEqual({
        type: 'daily',
        spent: 8.0,
        limit: 10,
        threshold: 0.8,
      });
    });
  });
});
