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

describe('BudgetManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BudgetManager();
    mockConfig.dailyBudgetUsd = 10;
    mockConfig.weeklyBudgetUsd = 50;
    mockConfig.budgetWarningThreshold = 0.8;
  });

  describe('initialize', () => {
    it('should read from Firebase and set state', async () => {
      const today = new Date().toISOString().split('T')[0];
      mockOnce.mockResolvedValue({
        val: () => ({
          daily: { date: today, spent: 3.5 },
          weekly: { weekStart: today, spent: 15.0 },
        }),
      });

      await manager.initialize('test-project');

      expect(mockRef).toHaveBeenCalledWith('budgets/test-project');
      expect(manager.initialized).toBe(true);
      expect(manager.getStatus().daily.spent).toBe(3.5);
    });

    it('should reset daily if date changed', async () => {
      mockOnce.mockResolvedValue({
        val: () => ({
          daily: { date: '2020-01-01', spent: 9.0 },
          weekly: { weekStart: '2020-01-01', spent: 40.0 },
        }),
      });

      await manager.initialize('test-project');

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(manager.getStatus().weekly.spent).toBe(0);
    });

    it('should handle null Firebase data', async () => {
      mockOnce.mockResolvedValue({ val: () => null });

      await manager.initialize('test-project');

      expect(manager.initialized).toBe(true);
      expect(manager.getStatus().daily.spent).toBe(0);
      expect(manager.getStatus().weekly.spent).toBe(0);
    });

    it('should handle Firebase errors gracefully', async () => {
      mockOnce.mockRejectedValue(new Error('network error'));

      await manager.initialize('test-project');

      expect(manager.initialized).toBe(true);
      expect(manager.getStatus().daily.spent).toBe(0);
    });
  });

  describe('addCost', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should increment daily and weekly spent', async () => {
      await manager.addCost(2.5);

      expect(manager.getStatus().daily.spent).toBe(2.5);
      expect(manager.getStatus().weekly.spent).toBe(2.5);
    });

    it('should persist to Firebase', async () => {
      await manager.addCost(1.0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          daily: expect.objectContaining({ spent: 1.0 }),
          weekly: expect.objectContaining({ spent: 1.0 }),
        }),
      );
    });

    it('should ignore zero or negative amounts', async () => {
      await manager.addCost(0);
      await manager.addCost(-1);

      expect(manager.getStatus().daily.spent).toBe(0);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should accumulate multiple costs', async () => {
      await manager.addCost(1.0);
      await manager.addCost(2.0);
      await manager.addCost(0.5);

      expect(manager.getStatus().daily.spent).toBe(3.5);
      expect(manager.getStatus().weekly.spent).toBe(3.5);
    });
  });

  describe('warning at threshold', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should emit budget:warning at 80% daily', async () => {
      await manager.addCost(8.0); // 80% of $10

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'daily', spent: 8.0, limit: 10 }),
      );
    });

    it('should emit budget:warning at 80% weekly', async () => {
      await manager.addCost(40.0); // 80% of $50

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:warning',
        expect.objectContaining({ type: 'weekly', spent: 40.0, limit: 50 }),
      );
    });

    it('should emit warning only once', async () => {
      await manager.addCost(8.0);
      await manager.addCost(0.5);

      const warningCalls = mockEmit.mock.calls.filter(c => c[0] === 'budget:warning' && c[1].type === 'daily');
      expect(warningCalls).toHaveLength(1);
    });
  });

  describe('budget exceeded', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should emit budget:exceeded when daily limit reached', async () => {
      await manager.addCost(10.0);

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:exceeded',
        expect.objectContaining({ type: 'daily', spent: 10.0, limit: 10 }),
      );
    });

    it('should emit budget:exceeded when weekly limit reached', async () => {
      mockConfig.dailyBudgetUsd = 100; // raise daily so it doesn't trigger first
      await manager.addCost(50.0);

      expect(mockEmit).toHaveBeenCalledWith(
        'budget:exceeded',
        expect.objectContaining({ type: 'weekly', spent: 50.0, limit: 50 }),
      );
    });
  });

  describe('isExceeded', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should return false when under budget', () => {
      expect(manager.isExceeded()).toBe(false);
    });

    it('should return true when daily exceeded', async () => {
      await manager.addCost(10.0);
      expect(manager.isExceeded()).toBe(true);
    });

    it('should return true when weekly exceeded', async () => {
      mockConfig.dailyBudgetUsd = 100;
      await manager.addCost(50.0);
      expect(manager.isExceeded()).toBe(true);
    });
  });

  describe('getStatus', () => {
    beforeEach(async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      await manager.initialize('test-project');
      vi.clearAllMocks();
    });

    it('should return correct status structure', () => {
      const status = manager.getStatus();

      expect(status).toHaveProperty('daily');
      expect(status).toHaveProperty('weekly');
      expect(status.daily).toHaveProperty('spent');
      expect(status.daily).toHaveProperty('limit');
      expect(status.daily).toHaveProperty('remaining');
      expect(status.daily).toHaveProperty('percentage');
    });

    it('should calculate remaining and percentage correctly', async () => {
      await manager.addCost(3.0);

      const status = manager.getStatus();
      expect(status.daily.remaining).toBe(7.0);
      expect(status.daily.percentage).toBeCloseTo(0.3);
      expect(status.weekly.remaining).toBe(47.0);
      expect(status.weekly.percentage).toBeCloseTo(0.06);
    });
  });
});
