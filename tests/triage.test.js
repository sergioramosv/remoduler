import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mock dependencies ===

const mockOnce = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockRef = vi.fn(() => ({
  once: mockOnce,
  set: mockSet,
}));

vi.mock('../src/firebase.js', () => ({
  getDb: () => ({ ref: mockRef }),
}));

vi.mock('../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../src/config.js', () => ({
  config: {
    triageEpsilon: 0.1,
    triageDecomposeThreshold: 5,
    triageForceModels: {},
  },
}));

// === Import modules after mocks ===

const { classifyComplexity, COMPLEXITY_LEVELS } = await import('../src/triage/complexity-classifier.js');
const { selectModel, MODEL_MAPS, FORCE_MODELS } = await import('../src/triage/model-selector.js');
const { SmartModelRouter } = await import('../src/triage/smart-model-router.js');
const { shouldDecompose, decomposeTask, DECOMPOSE_THRESHOLD } = await import('../src/triage/task-decomposer.js');

// === Tests ===

describe('complexity-classifier', () => {
  it('should export COMPLEXITY_LEVELS', () => {
    expect(COMPLEXITY_LEVELS.TRIVIAL).toBe('trivial');
    expect(COMPLEXITY_LEVELS.STANDARD).toBe('standard');
    expect(COMPLEXITY_LEVELS.COMPLEX).toBe('complex');
  });

  it('should classify devPoints=1 as trivial', () => {
    const result = classifyComplexity({ devPoints: 1 });
    expect(result.level).toBe('trivial');
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('should classify devPoints=2 as trivial', () => {
    const result = classifyComplexity({ devPoints: 2 });
    expect(result.level).toBe('trivial');
  });

  it('should classify devPoints=3 as standard', () => {
    const result = classifyComplexity({ devPoints: 3 });
    expect(result.level).toBe('standard');
  });

  it('should classify devPoints=5 as standard', () => {
    const result = classifyComplexity({ devPoints: 5 });
    expect(result.level).toBe('standard');
  });

  it('should classify devPoints=8 as complex', () => {
    const result = classifyComplexity({ devPoints: 8 });
    expect(result.level).toBe('complex');
  });

  it('should increase score for many acceptance criteria', () => {
    const base = classifyComplexity({ devPoints: 3 });
    const withCriteria = classifyComplexity({
      devPoints: 3,
      acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(withCriteria.score).toBeGreaterThan(base.score);
  });

  it('should increase score for complex keywords', () => {
    const base = classifyComplexity({ devPoints: 3 });
    const withKeywords = classifyComplexity({
      devPoints: 3,
      description: 'Requires database migration and security review',
    });
    expect(withKeywords.score).toBeGreaterThan(base.score);
  });

  it('should handle empty taskSpec gracefully', () => {
    const result = classifyComplexity({});
    expect(result.level).toBe('trivial');
    expect(result.score).toBe(1);
  });
});

describe('model-selector', () => {
  it('should return claude by default for any role', () => {
    expect(selectModel('CODER', 'standard')).toBe('claude');
    expect(selectModel('PLANNER', 'trivial')).toBe('claude');
  });

  it('should respect FORCE_MODELS for SECURITY', () => {
    expect(selectModel('SECURITY', 'trivial')).toBe('claude');
    expect(FORCE_MODELS.SECURITY).toBe('claude');
  });

  it('should fallback to claude for unknown role', () => {
    expect(selectModel('UNKNOWN_ROLE', 'standard')).toBe('claude');
  });

  it('should fallback to claude for unknown complexity', () => {
    expect(selectModel('CODER', 'unknown')).toBe('claude');
  });

  it('should have MODEL_MAPS for all complexity levels', () => {
    expect(MODEL_MAPS).toHaveProperty('trivial');
    expect(MODEL_MAPS).toHaveProperty('standard');
    expect(MODEL_MAPS).toHaveProperty('complex');
  });
});

describe('smart-model-router', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SmartModelRouter({ epsilon: 0, firebasePath: 'triage/modelStats' });
  });

  it('should exploit best model when epsilon=0', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 9, failures: 1, totalCost: 5, totalDuration: 100, samples: 10 },
        codex: { successes: 5, failures: 5, totalCost: 3, totalDuration: 80, samples: 10 },
      }),
    });

    const model = await router.route('CODER', 'standard');
    expect(model).toBe('claude');
  });

  it('should fallback to claude when Firebase returns null', async () => {
    mockOnce.mockResolvedValue({ val: () => null });

    const model = await router.route('CODER', 'standard');
    expect(model).toBe('claude');
  });

  it('should fallback to claude on Firebase error', async () => {
    mockOnce.mockRejectedValue(new Error('network error'));

    const model = await router.route('CODER', 'standard');
    expect(model).toBe('claude');
  });

  it('should explore random model when epsilon=1', async () => {
    const explorerRouter = new SmartModelRouter({ epsilon: 1 });
    const model = await explorerRouter.route('CODER', 'standard');
    expect(['claude', 'codex', 'gemini']).toContain(model);
  });

  it('should record outcome to Firebase', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({ successes: 5, failures: 1, totalCost: 3, totalDuration: 60, samples: 6 }),
    });

    await router.recordOutcome('CODER', 'claude', { success: true, cost: 0.5, duration: 10 });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 6,
      failures: 1,
      totalCost: 3.5,
      totalDuration: 70,
      samples: 7,
    });
  });

  it('should handle recordOutcome Firebase error gracefully', async () => {
    mockOnce.mockRejectedValue(new Error('write error'));

    // Should not throw
    await router.recordOutcome('CODER', 'claude', { success: true });
  });
});

describe('task-decomposer', () => {
  it('should return true for shouldDecompose when devPoints > threshold', () => {
    expect(shouldDecompose({ devPoints: 8 })).toBe(true);
    expect(shouldDecompose({ devPoints: 6 })).toBe(true);
  });

  it('should return false for shouldDecompose when devPoints <= threshold', () => {
    expect(shouldDecompose({ devPoints: 5 })).toBe(false);
    expect(shouldDecompose({ devPoints: 3 })).toBe(false);
    expect(shouldDecompose({ devPoints: 0 })).toBe(false);
  });

  it('should handle missing devPoints', () => {
    expect(shouldDecompose({})).toBe(false);
  });

  it('should decompose task into subtasks matching criteria count', () => {
    const task = {
      id: 'task-123',
      title: 'Big task',
      description: 'A big task',
      acceptanceCriteria: ['Criterion A', 'Criterion B', 'Criterion C'],
      devPoints: 9,
    };

    const subtasks = decomposeTask(task);

    expect(subtasks).toHaveLength(3);
    expect(subtasks[0].parentTaskId).toBe('task-123');
    expect(subtasks[0].acceptanceCriteria).toEqual(['Criterion A']);
    expect(subtasks[1].acceptanceCriteria).toEqual(['Criterion B']);
    expect(subtasks[2].acceptanceCriteria).toEqual(['Criterion C']);
  });

  it('should distribute devPoints proportionally', () => {
    const task = {
      title: 'Task',
      acceptanceCriteria: ['A', 'B'],
      devPoints: 6,
    };

    const subtasks = decomposeTask(task);
    const totalPoints = subtasks.reduce((sum, s) => sum + s.devPoints, 0);

    expect(totalPoints).toBe(6);
    expect(subtasks[0].devPoints).toBe(3);
    expect(subtasks[1].devPoints).toBe(3);
  });

  it('should return single subtask when no criteria', () => {
    const task = { title: 'Task', devPoints: 3, acceptanceCriteria: [] };
    const subtasks = decomposeTask(task);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].devPoints).toBe(3);
  });

  it('should have DECOMPOSE_THRESHOLD defined', () => {
    expect(typeof DECOMPOSE_THRESHOLD).toBe('number');
    expect(DECOMPOSE_THRESHOLD).toBe(5);
  });
});
