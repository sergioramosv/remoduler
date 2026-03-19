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

vi.mock('../src/config.js', () => ({
  config: {
    intelligenceCacheTtl: 300000,
    intelligenceMaxTokens: 2000,
    intelligenceDecayFactor: 0.95,
    intelligenceSyncThreshold: 0.6,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../src/events/event-bus.js', () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), clear: vi.fn() },
}));

// === Import modules after mocks ===

const { indexCodebase, clearIndexCache, INDEX_CACHE_TTL, MAX_TOKENS } =
  await import('../src/intelligence/codebase-indexer.js');

const { detectStyle, STYLE_RULES } =
  await import('../src/intelligence/style-detector.js');

const { learnFromTask, getLearnedPatterns, clearPatterns } =
  await import('../src/intelligence/codebase-learner.js');

const { recordIssue, getTopIssues, DECAY_FACTOR } =
  await import('../src/intelligence/review-feedback.js');

const { syncPatterns, calculateSimilarity, SYNC_THRESHOLD } =
  await import('../src/intelligence/cross-project-intelligence.js');

// ─── AC1: codebase-indexer — scan src/, summary, cache 5 min, max 2000 tokens ─
describe('QA: codebase-indexer acceptance', () => {
  beforeEach(() => {
    clearIndexCache();
  });

  it('scans src/ and generates a summary with files, structure, totalFiles, totalLines', async () => {
    const result = await indexCodebase('src/');
    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('structure');
    expect(result).toHaveProperty('totalFiles');
    expect(result).toHaveProperty('totalLines');
    expect(result.totalFiles).toBeGreaterThan(0);
  });

  it('cache TTL is 5 minutes (300000 ms)', () => {
    expect(INDEX_CACHE_TTL).toBe(300000);
  });

  it('max tokens is 2000', () => {
    expect(MAX_TOKENS).toBe(2000);
  });

  it('cache returns identical result within TTL', async () => {
    const first = await indexCodebase('src/');
    const second = await indexCodebase('src/');
    expect(second).toBe(first); // same reference = cached
  });

  it('cache invalidation allows re-scan', async () => {
    const first = await indexCodebase('src/');
    clearIndexCache();
    const second = await indexCodebase('src/');
    expect(second).not.toBe(first); // different reference = new scan
    expect(second).toHaveProperty('totalFiles');
  });

  it('output JSON does not exceed MAX_TOKENS + small margin', async () => {
    const result = await indexCodebase('src/');
    const json = JSON.stringify(result);
    // Allow a small margin because truncation is per-file granularity
    expect(json.length).toBeLessThanOrEqual(MAX_TOKENS + 300);
  });

  it('each file entry has path, exports, imports, lines fields', async () => {
    const result = await indexCodebase('src/');
    for (const file of result.files) {
      expect(file).toHaveProperty('path');
      expect(file).toHaveProperty('exports');
      expect(file).toHaveProperty('imports');
      expect(file).toHaveProperty('lines');
      expect(typeof file.lines).toBe('number');
      expect(Array.isArray(file.exports)).toBe(true);
      expect(Array.isArray(file.imports)).toBe(true);
    }
  });
});

describe('QA: codebase-indexer edge cases', () => {
  beforeEach(() => {
    clearIndexCache();
  });

  it('returns empty result for non-existent directory', async () => {
    const result = await indexCodebase('___nonexistent___/');
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
    expect(result.totalLines).toBe(0);
  });

  it('handles empty string directory gracefully', async () => {
    const result = await indexCodebase('');
    // Should return something without throwing
    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('totalFiles');
  });

  it('clearIndexCache is idempotent (calling twice does not throw)', () => {
    clearIndexCache();
    clearIndexCache();
  });
});

// ─── AC2: style-detector — naming, spacing, patterns, imports as obligatory ──
describe('QA: style-detector acceptance', () => {
  it('STYLE_RULES constant is "obligatory"', () => {
    expect(STYLE_RULES).toBe('obligatory');
  });

  it('detects naming convention (camelCase or snake_case)', async () => {
    const result = await detectStyle('src/');
    const naming = result.rules.find(r => r.rule === 'naming');
    expect(naming).toBeDefined();
    expect(['camelCase', 'snake_case']).toContain(naming.value);
  });

  it('detects spacing rule with format type:size', async () => {
    const result = await detectStyle('src/');
    const spacing = result.rules.find(r => r.rule === 'spacing');
    expect(spacing).toBeDefined();
    expect(spacing.value).toMatch(/^(spaces|tabs):\d+$/);
  });

  it('detects import pattern (ESM or CJS)', async () => {
    const result = await detectStyle('src/');
    const imports = result.rules.find(r => r.rule === 'imports');
    expect(imports).toBeDefined();
    expect(['ESM', 'CJS']).toContain(imports.value);
  });

  it('all detected rules have enforcement = "obligatory"', async () => {
    const result = await detectStyle('src/');
    expect(result.rules.length).toBeGreaterThan(0);
    for (const rule of result.rules) {
      expect(rule.enforcement).toBe('obligatory');
    }
  });

  it('each rule has confidence between 0 and 1', async () => {
    const result = await detectStyle('src/');
    for (const rule of result.rules) {
      expect(rule.confidence).toBeGreaterThanOrEqual(0);
      expect(rule.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('detects semicolons and quotes patterns', async () => {
    const result = await detectStyle('src/');
    const ruleNames = result.rules.map(r => r.rule);
    expect(ruleNames).toContain('semicolons');
    expect(ruleNames).toContain('quotes');
  });
});

describe('QA: style-detector edge cases', () => {
  it('returns empty rules for non-existent directory', async () => {
    const result = await detectStyle('___nonexistent___/');
    expect(result.rules).toEqual([]);
  });

  it('returns object with rules array (never null/undefined)', async () => {
    const result = await detectStyle('src/');
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(Array.isArray(result.rules)).toBe(true);
  });
});

// ─── AC3: codebase-learner — extract patterns, persist to Firebase ───────────
describe('QA: codebase-learner acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('learnFromTask extracts pattern and persists to Firebase', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => [] });

    const result = await learnFromTask('proj-qa', {
      filesCreated: ['src/a.js', 'src/b.ts'],
      filesModified: ['src/c.js'],
      testPattern: 'vitest',
      branchNaming: 'feature/',
      devPoints: 5,
    });

    expect(result).not.toBeNull();
    expect(result.filesCreated).toBe(2);
    expect(result.filesModified).toBe(1);
    expect(result.fileTypes).toContain('js');
    expect(result.fileTypes).toContain('ts');
    expect(result.testPattern).toBe('vitest');
    expect(result.branchNaming).toBe('feature/');
    expect(result.avgDevPoints).toBe(5);
    expect(result.learnedAt).toBeDefined();
    expect(mockRef).toHaveBeenCalledWith('intelligence/proj-qa/patterns');
    expect(mockSet).toHaveBeenCalled();
  });

  it('appends to existing patterns in Firebase', async () => {
    const existing = [{ filesCreated: 1, learnedAt: '2026-01-01T00:00:00Z' }];
    mockOnce.mockResolvedValueOnce({ val: () => existing });

    await learnFromTask('proj-qa', {
      filesCreated: ['src/new.js'],
      filesModified: [],
    });

    // mockSet should be called with array of length 2 (existing + new)
    const setArg = mockSet.mock.calls[0][0];
    expect(Array.isArray(setArg)).toBe(true);
    expect(setArg.length).toBe(2);
  });

  it('getLearnedPatterns reads patterns from Firebase', async () => {
    const patterns = [{ filesCreated: 3, fileTypes: ['js'] }];
    mockOnce.mockResolvedValueOnce({ val: () => patterns });

    const result = await getLearnedPatterns('proj-qa');
    expect(result).toEqual(patterns);
  });

  it('clearPatterns sets null in Firebase', async () => {
    await clearPatterns('proj-qa');
    expect(mockSet).toHaveBeenCalledWith(null);
  });
});

describe('QA: codebase-learner edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('learnFromTask handles null taskResult gracefully', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => [] });

    const result = await learnFromTask('proj-qa', null);
    expect(result).not.toBeNull();
    expect(result.filesCreated).toBe(0);
    expect(result.filesModified).toBe(0);
    expect(result.fileTypes).toEqual([]);
  });

  it('learnFromTask handles undefined taskResult gracefully', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => [] });

    const result = await learnFromTask('proj-qa', undefined);
    expect(result).not.toBeNull();
    expect(result.filesCreated).toBe(0);
  });

  it('learnFromTask handles empty taskResult gracefully', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => [] });

    const result = await learnFromTask('proj-qa', {});
    expect(result).not.toBeNull();
    expect(result.filesCreated).toBe(0);
    expect(result.filesModified).toBe(0);
  });

  it('getLearnedPatterns returns [] when Firebase returns null', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });
    const result = await getLearnedPatterns('proj-qa');
    expect(result).toEqual([]);
  });

  it('getLearnedPatterns returns [] when Firebase returns non-array', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => ({ notAnArray: true }) });
    const result = await getLearnedPatterns('proj-qa');
    expect(result).toEqual([]);
  });

  it('learnFromTask handles non-array existing data from Firebase', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => ({ broken: true }) });

    const result = await learnFromTask('proj-qa', {
      filesCreated: ['a.js'],
      filesModified: [],
    });
    // Should not crash; should treat non-array as empty
    expect(result).not.toBeNull();
    expect(mockSet).toHaveBeenCalled();
  });
});

// ─── AC4: review-feedback — top issues by frequency with time-decay ──────────
describe('QA: review-feedback acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DECAY_FACTOR is 0.95', () => {
    expect(DECAY_FACTOR).toBe(0.95);
  });

  it('recordIssue creates new issue with count=1', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    const result = await recordIssue('proj-qa', { type: 'lint', message: 'unused-var' });
    expect(result.count).toBe(1);
    expect(result.type).toBe('lint');
    expect(result.message).toBe('unused-var');
    expect(result.lastSeen).toBeDefined();
  });

  it('recordIssue increments existing issue count', async () => {
    mockOnce.mockResolvedValueOnce({
      val: () => ({ type: 'lint', message: 'unused-var', count: 5, lastSeen: '2026-01-01' }),
    });

    const result = await recordIssue('proj-qa', { type: 'lint', message: 'unused-var' });
    expect(result.count).toBe(6);
  });

  it('getTopIssues sorts by effective score (frequency * time-decay)', async () => {
    const now = new Date().toISOString();
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

    mockOnce.mockResolvedValueOnce({
      val: () => ({
        old_issue: { type: 'lint', message: 'old', count: 20, lastSeen: oldDate },
        recent_issue: { type: 'security', message: 'recent', count: 5, lastSeen: now },
      }),
    });

    const result = await getTopIssues('proj-qa', 5);
    expect(result.length).toBe(2);
    // Recent issue should rank higher due to heavy decay on old issue
    expect(result[0].type).toBe('security');
    expect(result[1].type).toBe('lint');
    // All should have effectiveScore
    for (const issue of result) {
      expect(issue.effectiveScore).toBeGreaterThan(0);
    }
  });

  it('getTopIssues respects limit parameter', async () => {
    const now = new Date().toISOString();
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        a: { type: 'a', message: 'a', count: 10, lastSeen: now },
        b: { type: 'b', message: 'b', count: 8, lastSeen: now },
        c: { type: 'c', message: 'c', count: 6, lastSeen: now },
        d: { type: 'd', message: 'd', count: 4, lastSeen: now },
      }),
    });

    const result = await getTopIssues('proj-qa', 2);
    expect(result.length).toBe(2);
  });

  it('getTopIssues defaults limit to 5', async () => {
    const now = new Date().toISOString();
    const issues = {};
    for (let i = 0; i < 8; i++) {
      issues[`issue${i}`] = { type: `t${i}`, message: `m${i}`, count: 10 - i, lastSeen: now };
    }
    mockOnce.mockResolvedValueOnce({ val: () => issues });

    const result = await getTopIssues('proj-qa');
    expect(result.length).toBe(5);
  });
});

describe('QA: review-feedback edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getTopIssues returns [] when no data', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });
    const result = await getTopIssues('proj-qa');
    expect(result).toEqual([]);
  });

  it('recordIssue handles missing type gracefully (defaults to "unknown")', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    const result = await recordIssue('proj-qa', { message: 'some error' });
    expect(result.type).toBe('unknown');
    expect(result.count).toBe(1);
  });

  it('recordIssue handles missing message gracefully', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    const result = await recordIssue('proj-qa', { type: 'lint' });
    expect(result.message).toBe('');
    expect(result.count).toBe(1);
  });

  it('recordIssue sanitizes key with special characters', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    await recordIssue('proj-qa', { type: 'lint.error[0]', message: 'bad' });
    // Firebase ref should use sanitized key
    const refPath = mockRef.mock.calls[0][0];
    expect(refPath).not.toContain('.');
    expect(refPath).not.toContain('[');
    expect(refPath).not.toContain(']');
  });
});

// ─── AC5: cross-project-intelligence — sync patterns, threshold 0.6 ─────────
describe('QA: cross-project-intelligence acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SYNC_THRESHOLD is 0.6', () => {
    expect(SYNC_THRESHOLD).toBe(0.6);
  });

  it('calculateSimilarity uses Jaccard index', () => {
    const a = [{ fileTypes: ['js', 'ts', 'css'] }];
    const b = [{ fileTypes: ['js', 'ts', 'py'] }];
    // intersection={js,ts}=2, union={js,ts,css,py}=4 => 2/4=0.5
    expect(calculateSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it('syncPatterns syncs when similarity >= 0.6', async () => {
    const patterns = [{ fileTypes: ['js', 'ts'], learnedAt: '2026-01-01T00:00:00Z' }];
    mockOnce
      .mockResolvedValueOnce({ val: () => patterns })
      .mockResolvedValueOnce({ val: () => patterns });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('syncPatterns does NOT sync when similarity < 0.6', async () => {
    mockOnce
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['js'] }] })
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['py', 'rb', 'go', 'java'] }] });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(false);
    expect(result.similarity).toBeLessThan(0.6);
  });

  it('syncPatterns merges non-duplicate patterns by learnedAt', async () => {
    const source = [
      { fileTypes: ['js'], learnedAt: '2026-01-01T00:00:00Z' },
      { fileTypes: ['js'], learnedAt: '2026-01-02T00:00:00Z' },
      { fileTypes: ['js'], learnedAt: '2026-01-03T00:00:00Z' },
    ];
    const target = [
      { fileTypes: ['js'], learnedAt: '2026-01-01T00:00:00Z' },
    ];

    mockOnce
      .mockResolvedValueOnce({ val: () => source })
      .mockResolvedValueOnce({ val: () => target });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(true);
    expect(result.mergedCount).toBe(3); // 1 existing + 2 new
  });
});

describe('QA: cross-project-intelligence edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculateSimilarity returns 0 for null inputs', () => {
    expect(calculateSimilarity(null, null)).toBe(0);
    expect(calculateSimilarity(null, [{ fileTypes: ['js'] }])).toBe(0);
    expect(calculateSimilarity([{ fileTypes: ['js'] }], null)).toBe(0);
  });

  it('calculateSimilarity returns 0 for empty arrays', () => {
    expect(calculateSimilarity([], [])).toBe(0);
    expect(calculateSimilarity([], [{ fileTypes: ['js'] }])).toBe(0);
  });

  it('calculateSimilarity returns 1 for identical patterns', () => {
    const p = [{ fileTypes: ['js', 'ts'] }];
    expect(calculateSimilarity(p, p)).toBe(1);
  });

  it('calculateSimilarity handles patterns without fileTypes', () => {
    const a = [{ fileTypes: ['js'] }];
    const b = [{}]; // no fileTypes
    // Should not throw
    const result = calculateSimilarity(a, b);
    expect(typeof result).toBe('number');
  });

  it('syncPatterns handles empty source gracefully', async () => {
    mockOnce
      .mockResolvedValueOnce({ val: () => null })
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['js'] }] });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(false);
    expect(result.similarity).toBe(0);
  });

  it('syncPatterns handles empty target gracefully', async () => {
    mockOnce
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['js'] }] })
      .mockResolvedValueOnce({ val: () => null });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(false);
    expect(result.similarity).toBe(0);
  });

  it('syncPatterns handles non-array Firebase data', async () => {
    mockOnce
      .mockResolvedValueOnce({ val: () => ({ notArray: true }) })
      .mockResolvedValueOnce({ val: () => ({ notArray: true }) });

    const result = await syncPatterns('projA', 'projB');
    // Should not throw, should handle gracefully
    expect(result).toHaveProperty('synced');
    expect(result).toHaveProperty('similarity');
  });
});
