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

// === Surgical Tests: Acceptance Criteria ===

describe('[AC] classifyComplexity returns trivial/standard/complex', () => {
  it('score boundary: score=2 is trivial, score=3 is standard', () => {
    // devPoints=2 → score=2 → trivial
    const trivial = classifyComplexity({ devPoints: 2 });
    expect(trivial.level).toBe('trivial');
    expect(trivial.score).toBe(2);

    // devPoints=3 → score=3 → standard
    const standard = classifyComplexity({ devPoints: 3 });
    expect(standard.level).toBe('standard');
    expect(standard.score).toBe(3);
  });

  it('score boundary: score=5 is standard, score=6 is complex', () => {
    // devPoints=5 → score=5 → standard
    const standard = classifyComplexity({ devPoints: 5 });
    expect(standard.level).toBe('standard');

    // devPoints=6 → score=6 → complex
    const complex = classifyComplexity({ devPoints: 6 });
    expect(complex.level).toBe('complex');
  });

  it('keywords in title also increase score', () => {
    const base = classifyComplexity({ devPoints: 2 });
    const withTitle = classifyComplexity({ devPoints: 2, title: 'Refactor authentication module' });
    expect(withTitle.score).toBeGreaterThan(base.score);
    expect(withTitle.reasons.some(r => r.includes('refactor'))).toBe(true);
  });

  it('combined factors escalate trivial devPoints to complex', () => {
    // devPoints=2 alone is trivial, but with 6 criteria + 3 keywords → complex
    const result = classifyComplexity({
      devPoints: 2,
      acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f'],
      description: 'security migration with database integration',
    });
    expect(result.level).toBe('complex');
    expect(result.score).toBeGreaterThan(5);
  });

  it('moderate criteria (4-5) add +1 to score', () => {
    const base = classifyComplexity({ devPoints: 3 });
    const withModerate = classifyComplexity({
      devPoints: 3,
      acceptanceCriteria: ['a', 'b', 'c', 'd'],
    });
    expect(withModerate.score).toBe(base.score + 1);
    expect(withModerate.reasons.some(r => r.includes('Moderate acceptance criteria'))).toBe(true);
  });
});

describe('[AC] selectModel consults forceModels and modelMaps', () => {
  it('MODEL_MAPS contains all standard roles for each complexity', () => {
    const roles = ['PLANNER', 'ARCHITECT', 'CODER', 'TESTER', 'SECURITY', 'REVIEWER'];
    for (const complexity of ['trivial', 'standard', 'complex']) {
      for (const role of roles) {
        expect(MODEL_MAPS[complexity]).toHaveProperty(role);
      }
    }
  });

  it('FORCE_MODELS override takes priority over MODEL_MAPS', () => {
    // SECURITY is in FORCE_MODELS, so it should return the forced value
    // regardless of complexity
    const trivial = selectModel('SECURITY', 'trivial');
    const standard = selectModel('SECURITY', 'standard');
    const complex = selectModel('SECURITY', 'complex');
    expect(trivial).toBe(FORCE_MODELS.SECURITY);
    expect(standard).toBe(FORCE_MODELS.SECURITY);
    expect(complex).toBe(FORCE_MODELS.SECURITY);
  });
});

describe('[AC] SmartModelRouter epsilon-greedy with Firebase history', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SmartModelRouter({ epsilon: 0, firebasePath: 'triage/modelStats' });
  });

  it('getBestModel picks model with highest success/cost ratio', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        // claude: 0.9 success rate, avgCost=0.5 → score = 0.9/0.5 = 1.8
        claude: { successes: 9, failures: 1, totalCost: 5, totalDuration: 100, samples: 10 },
        // gemini: 0.8 success rate, avgCost=0.2 → score = 0.8/0.2 = 4.0 (winner)
        gemini: { successes: 8, failures: 2, totalCost: 2, totalDuration: 50, samples: 10 },
      }),
    });

    const best = await router.getBestModel('CODER');
    expect(best).toBe('gemini');
  });

  it('getBestModel skips models with 0 samples', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 5, failures: 0, totalCost: 2, totalDuration: 50, samples: 5 },
        codex: { successes: 0, failures: 0, totalCost: 0, totalDuration: 0, samples: 0 },
      }),
    });

    const best = await router.getBestModel('CODER');
    expect(best).toBe('claude');
  });

  it('getBestModel handles zero-cost model (score = successRate)', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 8, failures: 2, totalCost: 0, totalDuration: 100, samples: 10 },
      }),
    });

    const best = await router.getBestModel('CODER');
    expect(best).toBe('claude');
  });

  it('recordOutcome initializes fresh stats when Firebase returns null', async () => {
    mockOnce.mockResolvedValue({ val: () => null });

    await router.recordOutcome('PLANNER', 'gemini', { success: true, cost: 1, duration: 5 });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 1,
      failures: 0,
      totalCost: 1,
      totalDuration: 5,
      samples: 1,
    });
  });

  it('recordOutcome increments failures on success=false', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({ successes: 3, failures: 1, totalCost: 2, totalDuration: 30, samples: 4 }),
    });

    await router.recordOutcome('CODER', 'codex', { success: false, cost: 0.5, duration: 8 });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 3,
      failures: 2,
      totalCost: 2.5,
      totalDuration: 38,
      samples: 5,
    });
  });

  it('recordOutcome defaults cost and duration to 0', async () => {
    mockOnce.mockResolvedValue({ val: () => null });

    await router.recordOutcome('TESTER', 'claude', { success: true });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 1,
      failures: 0,
      totalCost: 0,
      totalDuration: 0,
      samples: 1,
    });
  });

  it('route with epsilon=1 always returns a model from the pool', async () => {
    const explorer = new SmartModelRouter({ epsilon: 1 });
    const results = new Set();
    for (let i = 0; i < 20; i++) {
      results.add(await explorer.route('CODER', 'standard'));
    }
    // All results must be from the pool
    for (const model of results) {
      expect(['claude', 'codex', 'gemini']).toContain(model);
    }
    // With 20 tries at random, we should see at least 2 different models
    expect(results.size).toBeGreaterThanOrEqual(2);
  });
});

describe('[AC] decomposeTask divides large tasks (>threshold devPoints)', () => {
  it('subtask title includes Part N numbering', () => {
    const subtasks = decomposeTask({
      title: 'Big feature',
      acceptanceCriteria: ['X', 'Y'],
      devPoints: 6,
    });
    expect(subtasks[0].title).toBe('Big feature — Part 1');
    expect(subtasks[1].title).toBe('Big feature — Part 2');
  });

  it('subtask description references parent title and criterion', () => {
    const subtasks = decomposeTask({
      title: 'Auth module',
      acceptanceCriteria: ['Login works'],
      devPoints: 6,
    });
    expect(subtasks[0].description).toContain('Auth module');
    expect(subtasks[0].description).toContain('Login works');
  });

  it('handles uneven devPoints rounding', () => {
    const subtasks = decomposeTask({
      title: 'Task',
      acceptanceCriteria: ['A', 'B', 'C'],
      devPoints: 10,
    });
    // 10/3 = 3.333... → each rounded to 3.3
    expect(subtasks).toHaveLength(3);
    subtasks.forEach(s => {
      expect(s.devPoints).toBe(3.3);
    });
  });

  it('parentTaskId is undefined when task has no id', () => {
    const subtasks = decomposeTask({
      title: 'No ID task',
      acceptanceCriteria: ['Done'],
      devPoints: 8,
    });
    expect(subtasks[0].parentTaskId).toBeUndefined();
  });

  it('shouldDecompose returns false at exact threshold boundary', () => {
    expect(shouldDecompose({ devPoints: DECOMPOSE_THRESHOLD })).toBe(false);
    expect(shouldDecompose({ devPoints: DECOMPOSE_THRESHOLD + 1 })).toBe(true);
  });

  it('single criterion produces single subtask with full devPoints', () => {
    const subtasks = decomposeTask({
      id: 'task-1',
      title: 'Single',
      acceptanceCriteria: ['Only one'],
      devPoints: 8,
    });
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].devPoints).toBe(8);
    expect(subtasks[0].parentTaskId).toBe('task-1');
  });
});

// === Risk-based edge cases ===

describe('[Risk] Firebase unavailability fallbacks', () => {
  it('route falls back to claude when getBestModel returns null (no history)', async () => {
    const router = new SmartModelRouter({ epsilon: 0 });
    mockOnce.mockResolvedValue({ val: () => null });

    const model = await router.route('ARCHITECT', 'complex');
    expect(model).toBe('claude');
  });

  it('recordOutcome silently swallows Firebase write errors', async () => {
    const router = new SmartModelRouter({ epsilon: 0 });
    mockOnce.mockRejectedValue(new Error('Firebase unavailable'));

    // Should not throw
    await expect(
      router.recordOutcome('CODER', 'claude', { success: true, cost: 1, duration: 10 })
    ).resolves.toBeUndefined();
  });
});
