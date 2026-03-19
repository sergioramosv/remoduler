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

// =====================================================================
// QA TESTS — Acceptance Criteria + Edge Cases + Unit Tests
// =====================================================================

// --- AC1: classifyComplexity(taskSpec) retorna trivial/standard/complex ---

describe('QA: complexity-classifier acceptance', () => {
  it('AC1: returns "trivial" for low-complexity tasks', () => {
    const result = classifyComplexity({ devPoints: 1, title: 'Fix typo' });
    expect(result.level).toBe('trivial');
    expect(result).toHaveProperty('reasons');
    expect(result).toHaveProperty('score');
  });

  it('AC1: returns "standard" for mid-complexity tasks', () => {
    const result = classifyComplexity({
      devPoints: 4,
      acceptanceCriteria: ['a', 'b', 'c', 'd'],
    });
    expect(result.level).toBe('standard');
  });

  it('AC1: returns "complex" for high-complexity tasks', () => {
    const result = classifyComplexity({
      devPoints: 8,
      acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f'],
      title: 'Database migration with security review',
    });
    expect(result.level).toBe('complex');
  });

  it('AC1: return value always has level, reasons, score', () => {
    const result = classifyComplexity({ devPoints: 3 });
    expect(typeof result.level).toBe('string');
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(typeof result.score).toBe('number');
    expect(['trivial', 'standard', 'complex']).toContain(result.level);
  });
});

describe('QA: complexity-classifier edge cases', () => {
  it('handles devPoints=0', () => {
    const result = classifyComplexity({ devPoints: 0 });
    expect(result.level).toBe('trivial');
    expect(result.score).toBe(0);
  });

  it('handles negative devPoints', () => {
    const result = classifyComplexity({ devPoints: -1 });
    expect(result.level).toBe('trivial');
  });

  it('detects keywords in title, not just description', () => {
    const result = classifyComplexity({ devPoints: 1, title: 'Refactor authentication' });
    expect(result.score).toBeGreaterThan(1);
    expect(result.reasons.some(r => r.includes('refactor'))).toBe(true);
  });

  it('combines all factors for maximum complexity', () => {
    const result = classifyComplexity({
      devPoints: 10,
      acceptanceCriteria: Array(8).fill('criterion'),
      title: 'Security infrastructure migration',
      description: 'Database refactor with performance tuning',
    });
    expect(result.level).toBe('complex');
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it('handles empty strings for title and description', () => {
    const result = classifyComplexity({ devPoints: 1, title: '', description: '' });
    expect(result.level).toBe('trivial');
  });

  it('criteria count 4 adds +1 to score (moderate)', () => {
    const base = classifyComplexity({ devPoints: 3 });
    const with4 = classifyComplexity({ devPoints: 3, acceptanceCriteria: ['a', 'b', 'c', 'd'] });
    expect(with4.score).toBe(base.score + 1);
  });

  it('criteria count 6 adds +2 to score (many)', () => {
    const base = classifyComplexity({ devPoints: 3 });
    const with6 = classifyComplexity({ devPoints: 3, acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(with6.score).toBe(base.score + 2);
  });
});

// --- AC2: selectModel(role, complexity) consulta forceModels y modelMaps ---

describe('QA: model-selector acceptance', () => {
  it('AC2: consults FORCE_MODELS first (SECURITY always forced)', () => {
    const result = selectModel('SECURITY', 'trivial');
    expect(result).toBe(FORCE_MODELS.SECURITY);
  });

  it('AC2: consults MODEL_MAPS when no force override', () => {
    const result = selectModel('CODER', 'complex');
    expect(result).toBe(MODEL_MAPS.complex.CODER);
  });

  it('AC2: selectModel returns string for all role×complexity combos', () => {
    const roles = ['PLANNER', 'ARCHITECT', 'CODER', 'TESTER', 'SECURITY', 'REVIEWER'];
    const levels = ['trivial', 'standard', 'complex'];
    for (const role of roles) {
      for (const level of levels) {
        const model = selectModel(role, level);
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('QA: model-selector edge cases', () => {
  it('returns fallback for null complexity', () => {
    const result = selectModel('CODER', null);
    expect(result).toBe('claude');
  });

  it('returns fallback for undefined role and complexity', () => {
    const result = selectModel(undefined, undefined);
    expect(result).toBe('claude');
  });

  it('returns fallback for empty string role', () => {
    const result = selectModel('', 'standard');
    expect(result).toBe('claude');
  });

  it('MODEL_MAPS has all 6 roles for each complexity', () => {
    const expectedRoles = ['PLANNER', 'ARCHITECT', 'CODER', 'TESTER', 'SECURITY', 'REVIEWER'];
    for (const level of ['trivial', 'standard', 'complex']) {
      for (const role of expectedRoles) {
        expect(MODEL_MAPS[level]).toHaveProperty(role);
      }
    }
  });
});

// --- AC3: epsilon-greedy routing con historico Firebase ---

describe('QA: smart-model-router acceptance', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SmartModelRouter({ epsilon: 0, firebasePath: 'test/modelStats' });
  });

  it('AC3: epsilon-greedy exploits best model from Firebase history', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 8, failures: 2, totalCost: 10, totalDuration: 100, samples: 10 },
        gemini: { successes: 9, failures: 1, totalCost: 5, totalDuration: 80, samples: 10 },
      }),
    });

    const model = await router.route('CODER', 'standard');
    // gemini has 0.9/0.5=1.8 vs claude 0.8/1.0=0.8, gemini wins
    expect(model).toBe('gemini');
  });

  it('AC3: epsilon-greedy explores randomly when epsilon=1', async () => {
    const explorRouter = new SmartModelRouter({ epsilon: 1 });
    const models = new Set();
    for (let i = 0; i < 50; i++) {
      models.add(await explorRouter.route('CODER', 'standard'));
    }
    // With 50 iterations and epsilon=1, we should hit at least 2 different models
    expect(models.size).toBeGreaterThanOrEqual(2);
  });

  it('AC3: records outcome to Firebase and increments counters', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({ successes: 0, failures: 0, totalCost: 0, totalDuration: 0, samples: 0 }),
    });

    await router.recordOutcome('PLANNER', 'claude', { success: true, cost: 1.5, duration: 30 });

    expect(mockRef).toHaveBeenCalledWith('test/modelStats/PLANNER/claude');
    expect(mockSet).toHaveBeenCalledWith({
      successes: 1,
      failures: 0,
      totalCost: 1.5,
      totalDuration: 30,
      samples: 1,
    });
  });

  it('AC3: recordOutcome with failure increments failures', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({ successes: 3, failures: 1, totalCost: 5, totalDuration: 60, samples: 4 }),
    });

    await router.recordOutcome('CODER', 'codex', { success: false, cost: 2, duration: 15 });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 3,
      failures: 2,
      totalCost: 7,
      totalDuration: 75,
      samples: 5,
    });
  });
});

describe('QA: smart-model-router edge cases', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SmartModelRouter({ epsilon: 0 });
  });

  it('getBestModel skips models with 0 samples', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 0, failures: 0, totalCost: 0, totalDuration: 0, samples: 0 },
        codex: { successes: 5, failures: 1, totalCost: 3, totalDuration: 50, samples: 6 },
      }),
    });

    const best = await router.getBestModel('CODER');
    expect(best).toBe('codex');
  });

  it('getBestModel returns null when no stats exist', async () => {
    mockOnce.mockResolvedValue({ val: () => null });
    const best = await router.getBestModel('CODER');
    expect(best).toBeNull();
  });

  it('getBestModel handles zero-cost models (score = successRate)', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 8, failures: 2, totalCost: 0, totalDuration: 100, samples: 10 },
        codex: { successes: 9, failures: 1, totalCost: 0, totalDuration: 80, samples: 10 },
      }),
    });

    const best = await router.getBestModel('CODER');
    expect(best).toBe('codex'); // 0.9 > 0.8
  });

  it('recordOutcome initializes stats when Firebase returns null', async () => {
    mockOnce.mockResolvedValue({ val: () => null });

    await router.recordOutcome('TESTER', 'gemini', { success: true, cost: 0.5, duration: 20 });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 1,
      failures: 0,
      totalCost: 0.5,
      totalDuration: 20,
      samples: 1,
    });
  });

  it('recordOutcome defaults cost and duration to 0', async () => {
    mockOnce.mockResolvedValue({ val: () => null });

    await router.recordOutcome('CODER', 'claude', { success: false });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 0,
      failures: 1,
      totalCost: 0,
      totalDuration: 0,
      samples: 1,
    });
  });

  it('constructor uses default epsilon when none provided', () => {
    const defaultRouter = new SmartModelRouter();
    // Should not throw — epsilon comes from config mock (0.1)
    expect(defaultRouter).toBeInstanceOf(SmartModelRouter);
  });
});

// --- AC4: decomposeTask() divide tareas grandes (>threshold devPoints) ---

describe('QA: task-decomposer acceptance', () => {
  it('AC4: shouldDecompose returns true when devPoints > threshold', () => {
    expect(shouldDecompose({ devPoints: DECOMPOSE_THRESHOLD + 1 })).toBe(true);
  });

  it('AC4: shouldDecompose returns false when devPoints <= threshold', () => {
    expect(shouldDecompose({ devPoints: DECOMPOSE_THRESHOLD })).toBe(false);
  });

  it('AC4: decomposeTask splits by acceptance criteria', () => {
    const task = {
      id: 'task-abc',
      title: 'Large feature',
      description: 'Build it all',
      acceptanceCriteria: ['Do X', 'Do Y', 'Do Z'],
      devPoints: 9,
    };

    const subtasks = decomposeTask(task);

    expect(subtasks).toHaveLength(3);
    subtasks.forEach((sub, i) => {
      expect(sub.title).toBe(`Large feature — Part ${i + 1}`);
      expect(sub.parentTaskId).toBe('task-abc');
      expect(sub.acceptanceCriteria).toHaveLength(1);
      expect(sub.devPoints).toBe(3);
    });
  });

  it('AC4: subtask descriptions reference parent and criterion', () => {
    const task = {
      title: 'Parent',
      acceptanceCriteria: ['Criterion Alpha'],
      devPoints: 3,
    };
    const subtasks = decomposeTask(task);
    expect(subtasks[0].description).toContain('Parent');
    expect(subtasks[0].description).toContain('Criterion Alpha');
  });
});

describe('QA: task-decomposer edge cases', () => {
  it('decomposeTask with single criterion returns one subtask', () => {
    const task = {
      id: 'task-1',
      title: 'Small',
      acceptanceCriteria: ['Only criterion'],
      devPoints: 4,
    };
    const subtasks = decomposeTask(task);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].devPoints).toBe(4);
    expect(subtasks[0].title).toBe('Small — Part 1');
  });

  it('decomposeTask with no id sets parentTaskId to undefined', () => {
    const task = { title: 'No ID', acceptanceCriteria: ['A'], devPoints: 3 };
    const subtasks = decomposeTask(task);
    expect(subtasks[0].parentTaskId).toBeUndefined();
  });

  it('decomposeTask with uneven devPoints rounds to 1 decimal', () => {
    const task = {
      title: 'Uneven',
      acceptanceCriteria: ['A', 'B', 'C'],
      devPoints: 10,
    };
    const subtasks = decomposeTask(task);
    // 10/3 = 3.333... rounded to 3.3
    subtasks.forEach(sub => {
      expect(sub.devPoints).toBe(3.3);
    });
  });

  it('decomposeTask with empty object uses defaults', () => {
    const subtasks = decomposeTask({});
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].title).toBe('');
    expect(subtasks[0].devPoints).toBe(1);
  });

  it('shouldDecompose with undefined devPoints defaults to 0', () => {
    expect(shouldDecompose({ title: 'no points' })).toBe(false);
  });

  it('DECOMPOSE_THRESHOLD equals config value', () => {
    expect(DECOMPOSE_THRESHOLD).toBe(5);
  });
});
