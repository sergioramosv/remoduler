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
// AC VALIDATION TESTS — Focused on untested paths & contract validation
// =====================================================================

// --- AC1: classifyComplexity(taskSpec) retorna trivial/standard/complex ---

describe('AC1 Validation: classifyComplexity contract', () => {
  it('COMPLEXITY_LEVELS exports trivial, standard, complex constants', () => {
    expect(COMPLEXITY_LEVELS.TRIVIAL).toBe('trivial');
    expect(COMPLEXITY_LEVELS.STANDARD).toBe('standard');
    expect(COMPLEXITY_LEVELS.COMPLEX).toBe('complex');
  });

  it('keywords in description only (not title) still increase score', () => {
    const base = classifyComplexity({ devPoints: 1 });
    const withDesc = classifyComplexity({ devPoints: 1, description: 'database performance tuning' });
    expect(withDesc.score).toBeGreaterThan(base.score);
    expect(withDesc.reasons.some(r => r.includes('database'))).toBe(true);
    expect(withDesc.reasons.some(r => r.includes('performance'))).toBe(true);
  });

  it('each keyword adds exactly +1 to score', () => {
    const base = classifyComplexity({ devPoints: 1 });
    const one = classifyComplexity({ devPoints: 1, title: 'refactor' });
    const two = classifyComplexity({ devPoints: 1, title: 'refactor migration' });
    expect(one.score).toBe(base.score + 1);
    expect(two.score).toBe(base.score + 2);
  });

  it('duplicate keywords in title+description count only once', () => {
    const result = classifyComplexity({
      devPoints: 1,
      title: 'refactor module',
      description: 'refactor the module completely',
    });
    // 'refactor' appears in both but filter uses .includes on the combined text
    // so it matches once per keyword
    const keywordCount = result.reasons
      .filter(r => r.includes('Complex keywords'))
      .map(r => r.split(': ')[1]?.split(', ').length || 0)[0] || 0;
    expect(keywordCount).toBe(1); // 'refactor' counted once
  });

  it('exactly 3 criteria does NOT add score (boundary: >3 needed)', () => {
    const base = classifyComplexity({ devPoints: 2 });
    const with3 = classifyComplexity({ devPoints: 2, acceptanceCriteria: ['a', 'b', 'c'] });
    expect(with3.score).toBe(base.score);
  });

  it('exactly 5 criteria adds +1 (boundary: <=5 is moderate)', () => {
    const base = classifyComplexity({ devPoints: 2 });
    const with5 = classifyComplexity({ devPoints: 2, acceptanceCriteria: ['a', 'b', 'c', 'd', 'e'] });
    expect(with5.score).toBe(base.score + 1);
  });

  it('reasons array describes all scoring factors', () => {
    const result = classifyComplexity({
      devPoints: 3,
      acceptanceCriteria: ['a', 'b', 'c', 'd'],
      title: 'Security review',
    });
    expect(result.reasons.some(r => r.includes('Moderate devPoints'))).toBe(true);
    expect(result.reasons.some(r => r.includes('Moderate acceptance criteria'))).toBe(true);
    expect(result.reasons.some(r => r.includes('security'))).toBe(true);
  });

  it('devPoints reasons: low (<=2), moderate (3-5), high (>5)', () => {
    expect(classifyComplexity({ devPoints: 2 }).reasons[0]).toContain('Low devPoints');
    expect(classifyComplexity({ devPoints: 3 }).reasons[0]).toContain('Moderate devPoints');
    expect(classifyComplexity({ devPoints: 6 }).reasons[0]).toContain('High devPoints');
  });
});

// --- AC2: selectModel(role, complexity) consulta forceModels y modelMaps ---

describe('AC2 Validation: selectModel force + map lookup', () => {
  it('FORCE_MODELS includes SECURITY with value "claude"', () => {
    expect(FORCE_MODELS).toHaveProperty('SECURITY', 'claude');
  });

  it('force model overrides even when MODEL_MAPS has different value', () => {
    // SECURITY is forced → should ignore MODEL_MAPS entirely
    for (const level of ['trivial', 'standard', 'complex']) {
      expect(selectModel('SECURITY', level)).toBe(FORCE_MODELS.SECURITY);
    }
  });

  it('non-forced roles fall through to MODEL_MAPS lookup', () => {
    const result = selectModel('PLANNER', 'standard');
    expect(result).toBe(MODEL_MAPS.standard.PLANNER);
  });

  it('unknown role with valid complexity falls back to "claude"', () => {
    expect(selectModel('UNKNOWN_ROLE', 'standard')).toBe('claude');
  });

  it('valid role with unknown complexity falls back to "claude"', () => {
    expect(selectModel('CODER', 'ultra')).toBe('claude');
  });

  it('FORCE_MODELS takes priority order: hardcoded then env', () => {
    // SECURITY is hardcoded, env can add but not override it
    expect(FORCE_MODELS.SECURITY).toBe('claude');
  });
});

// --- AC3: epsilon-greedy routing con historico Firebase ---

describe('AC3 Validation: SmartModelRouter epsilon-greedy + Firebase', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SmartModelRouter({ epsilon: 0, firebasePath: 'test/validation' });
  });

  it('route with epsilon=0 never explores (always exploits)', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        claude: { successes: 10, failures: 0, totalCost: 5, totalDuration: 100, samples: 10 },
      }),
    });

    // Run 20 times — should always pick claude (exploit)
    for (let i = 0; i < 20; i++) {
      const model = await router.route('CODER', 'standard');
      expect(model).toBe('claude');
    }
  });

  it('route falls back to "claude" when Firebase read throws', async () => {
    mockOnce.mockRejectedValue(new Error('Network error'));
    const model = await router.route('CODER', 'complex');
    expect(model).toBe('claude');
  });

  it('getBestModel scores by successRate/avgCost ratio', async () => {
    mockOnce.mockResolvedValue({
      val: () => ({
        // claude: sr=0.7, avgCost=1.0 → score=0.7
        claude: { successes: 7, failures: 3, totalCost: 10, totalDuration: 100, samples: 10 },
        // codex: sr=0.6, avgCost=0.1 → score=6.0 (winner)
        codex: { successes: 6, failures: 4, totalCost: 1, totalDuration: 50, samples: 10 },
      }),
    });

    const best = await router.getBestModel('ARCHITECT');
    expect(best).toBe('codex');
  });

  it('getBestModel returns null for empty stats object', async () => {
    mockOnce.mockResolvedValue({ val: () => ({}) });
    const best = await router.getBestModel('REVIEWER');
    expect(best).toBeNull();
  });

  it('recordOutcome accumulates stats correctly over multiple calls', async () => {
    // First call — empty stats
    mockOnce.mockResolvedValueOnce({ val: () => null });
    await router.recordOutcome('CODER', 'claude', { success: true, cost: 2, duration: 10 });

    expect(mockSet).toHaveBeenCalledWith({
      successes: 1, failures: 0, totalCost: 2, totalDuration: 10, samples: 1,
    });

    // Second call — existing stats from first call
    mockOnce.mockResolvedValueOnce({
      val: () => ({ successes: 1, failures: 0, totalCost: 2, totalDuration: 10, samples: 1 }),
    });
    await router.recordOutcome('CODER', 'claude', { success: false, cost: 1.5, duration: 8 });

    expect(mockSet).toHaveBeenLastCalledWith({
      successes: 1, failures: 1, totalCost: 3.5, totalDuration: 18, samples: 2,
    });
  });

  it('recordOutcome uses correct Firebase path', async () => {
    mockOnce.mockResolvedValue({ val: () => null });
    await router.recordOutcome('TESTER', 'gemini', { success: true, cost: 0.5, duration: 5 });

    expect(mockRef).toHaveBeenCalledWith('test/validation/TESTER/gemini');
  });

  it('singleton smartModelRouter is exported and functional', async () => {
    const { smartModelRouter } = await import('../src/triage/smart-model-router.js');
    expect(smartModelRouter).toBeInstanceOf(SmartModelRouter);
  });
});

// --- AC4: decomposeTask() divide tareas grandes (>threshold devPoints) ---

describe('AC4 Validation: decomposeTask large task decomposition', () => {
  it('decomposeTask with no criteria returns single subtask fallback', () => {
    const task = { id: 'task-99', title: 'No criteria', description: 'desc', devPoints: 8 };
    const subtasks = decomposeTask(task);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].title).toBe('No criteria');
    expect(subtasks[0].description).toBe('desc');
    expect(subtasks[0].acceptanceCriteria).toEqual([]);
    expect(subtasks[0].devPoints).toBe(8);
    expect(subtasks[0].parentTaskId).toBe('task-99');
  });

  it('subtask description format: "Subtask of: {title}\\n\\nFocus: {criterion}"', () => {
    const subtasks = decomposeTask({
      title: 'Auth module',
      acceptanceCriteria: ['Login works', 'Logout works'],
      devPoints: 6,
    });
    expect(subtasks[0].description).toBe('Subtask of: Auth module\n\nFocus: Login works');
    expect(subtasks[1].description).toBe('Subtask of: Auth module\n\nFocus: Logout works');
  });

  it('each subtask has exactly one acceptance criterion from parent', () => {
    const criteria = ['Build API', 'Write tests', 'Deploy'];
    const subtasks = decomposeTask({
      title: 'Full feature',
      acceptanceCriteria: criteria,
      devPoints: 9,
    });

    subtasks.forEach((sub, i) => {
      expect(sub.acceptanceCriteria).toEqual([criteria[i]]);
    });
  });

  it('devPoints distributed equally: 7 points / 2 criteria = 3.5 each', () => {
    const subtasks = decomposeTask({
      title: 'Split',
      acceptanceCriteria: ['A', 'B'],
      devPoints: 7,
    });
    expect(subtasks[0].devPoints).toBe(3.5);
    expect(subtasks[1].devPoints).toBe(3.5);
  });

  it('devPoints with many criteria: 7 points / 7 criteria = 1.0 each', () => {
    const subtasks = decomposeTask({
      title: 'Many',
      acceptanceCriteria: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      devPoints: 7,
    });
    subtasks.forEach(s => expect(s.devPoints).toBe(1));
  });

  it('shouldDecompose + decomposeTask integration: full flow', () => {
    const task = {
      id: 'task-integration',
      title: 'Big task',
      acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
      devPoints: 12,
    };

    expect(shouldDecompose(task)).toBe(true);
    const subtasks = decomposeTask(task);

    expect(subtasks).toHaveLength(3);
    expect(subtasks.every(s => s.parentTaskId === 'task-integration')).toBe(true);
    expect(subtasks.every(s => s.devPoints === 4)).toBe(true);
    expect(subtasks[0].title).toBe('Big task — Part 1');
    expect(subtasks[2].title).toBe('Big task — Part 3');
  });

  it('shouldDecompose returns false for task below threshold (no decomposition)', () => {
    const task = { devPoints: 3 };
    expect(shouldDecompose(task)).toBe(false);
  });
});
