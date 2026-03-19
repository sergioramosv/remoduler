import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
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

// --- Imports (after mocks) ---
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

// ─── codebase-indexer ────────────────────────────────────────────────
describe('codebase-indexer', () => {
  beforeEach(() => {
    clearIndexCache();
  });

  it('exports INDEX_CACHE_TTL as 300000', () => {
    expect(INDEX_CACHE_TTL).toBe(300000);
  });

  it('exports MAX_TOKENS as 2000', () => {
    expect(MAX_TOKENS).toBe(2000);
  });

  it('indexCodebase returns expected structure for src/', async () => {
    const result = await indexCodebase('src/');
    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('structure');
    expect(result).toHaveProperty('totalFiles');
    expect(result).toHaveProperty('totalLines');
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.totalFiles).toBe('number');
    expect(typeof result.totalLines).toBe('number');
  });

  it('returns cached result on second call', async () => {
    const first = await indexCodebase('src/');
    const second = await indexCodebase('src/');
    expect(second).toEqual(first);
  });

  it('clearIndexCache clears the cache', async () => {
    await indexCodebase('src/');
    clearIndexCache();
    // After clearing, a new scan should occur (no error)
    const result = await indexCodebase('src/');
    expect(result).toHaveProperty('totalFiles');
  });

  it('returns empty result for non-existent directory', async () => {
    const result = await indexCodebase('non-existent-dir-xyz/');
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });

  it('respects max tokens limit', async () => {
    const result = await indexCodebase('src/');
    const json = JSON.stringify(result);
    expect(json.length).toBeLessThanOrEqual(MAX_TOKENS + 200); // small margin for truncation granularity
  });

  it('file entries have path, exports, imports, lines', async () => {
    const result = await indexCodebase('src/');
    if (result.files.length > 0) {
      const file = result.files[0];
      expect(file).toHaveProperty('path');
      expect(file).toHaveProperty('exports');
      expect(file).toHaveProperty('imports');
      expect(file).toHaveProperty('lines');
    }
  });
});

// ─── style-detector ──────────────────────────────────────────────────
describe('style-detector', () => {
  it('STYLE_RULES is obligatory', () => {
    expect(STYLE_RULES).toBe('obligatory');
  });

  it('detectStyle returns rules array', async () => {
    const result = await detectStyle('src/');
    expect(result).toHaveProperty('rules');
    expect(Array.isArray(result.rules)).toBe(true);
  });

  it('detects ESM imports from src/', async () => {
    const result = await detectStyle('src/');
    const importRule = result.rules.find(r => r.rule === 'imports');
    expect(importRule).toBeDefined();
    expect(importRule.value).toBe('ESM');
  });

  it('detects camelCase naming from src/', async () => {
    const result = await detectStyle('src/');
    const namingRule = result.rules.find(r => r.rule === 'naming');
    if (namingRule) {
      expect(namingRule.value).toBe('camelCase');
    }
  });

  it('detects spacing', async () => {
    const result = await detectStyle('src/');
    const spacingRule = result.rules.find(r => r.rule === 'spacing');
    expect(spacingRule).toBeDefined();
    expect(spacingRule.value).toMatch(/^(spaces|tabs):\d+$/);
  });

  it('all rules have enforcement = obligatory', async () => {
    const result = await detectStyle('src/');
    for (const rule of result.rules) {
      expect(rule.enforcement).toBe('obligatory');
    }
  });

  it('returns empty rules for non-existent directory', async () => {
    const result = await detectStyle('non-existent-dir-xyz/');
    expect(result.rules).toEqual([]);
  });
});

// ─── codebase-learner ────────────────────────────────────────────────
describe('codebase-learner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('learnFromTask writes pattern to Firebase', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => [] });

    const result = await learnFromTask('proj1', {
      filesCreated: ['src/foo.js'],
      filesModified: ['src/bar.js'],
      testPattern: 'vitest',
      branchNaming: 'feature/',
      devPoints: 3,
    });

    expect(result).not.toBeNull();
    expect(result.filesCreated).toBe(1);
    expect(result.filesModified).toBe(1);
    expect(result.fileTypes).toContain('js');
    expect(result.testPattern).toBe('vitest');
    expect(result.branchNaming).toBe('feature/');
    expect(result.avgDevPoints).toBe(3);
    expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/patterns');
    expect(mockSet).toHaveBeenCalled();
  });

  it('getLearnedPatterns reads from Firebase', async () => {
    const patterns = [{ filesCreated: 2, fileTypes: ['js'] }];
    mockOnce.mockResolvedValueOnce({ val: () => patterns });

    const result = await getLearnedPatterns('proj1');
    expect(result).toEqual(patterns);
    expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/patterns');
  });

  it('getLearnedPatterns returns empty array when no data', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    const result = await getLearnedPatterns('proj1');
    expect(result).toEqual([]);
  });

  it('clearPatterns sets null in Firebase', async () => {
    await clearPatterns('proj1');
    expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/patterns');
    expect(mockSet).toHaveBeenCalledWith(null);
  });
});

// ─── review-feedback ─────────────────────────────────────────────────
describe('review-feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DECAY_FACTOR defaults to 0.95', () => {
    expect(DECAY_FACTOR).toBe(0.95);
  });

  it('recordIssue increments count', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => ({ type: 'lint', message: 'no-unused-vars', count: 2, lastSeen: '2026-01-01' }) });

    const result = await recordIssue('proj1', { type: 'lint', message: 'no-unused-vars' });
    expect(result.count).toBe(3);
    expect(mockSet).toHaveBeenCalled();
  });

  it('recordIssue starts count at 1 for new issue', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    const result = await recordIssue('proj1', { type: 'security', message: 'xss detected' });
    expect(result.count).toBe(1);
    expect(result.type).toBe('security');
  });

  it('getTopIssues applies time-decay and sorts', async () => {
    const now = new Date().toISOString();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

    mockOnce.mockResolvedValueOnce({
      val: () => ({
        lint: { type: 'lint', message: 'no-unused', count: 10, lastSeen: oldDate },
        security: { type: 'security', message: 'xss', count: 5, lastSeen: now },
      }),
    });

    const result = await getTopIssues('proj1', 5);
    expect(result.length).toBe(2);
    // Recent issue with lower count should rank higher due to decay
    expect(result[0].type).toBe('security');
    expect(result[0].effectiveScore).toBeGreaterThan(0);
  });

  it('getTopIssues returns empty for no data', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });
    const result = await getTopIssues('proj1');
    expect(result).toEqual([]);
  });

  it('getTopIssues respects limit', async () => {
    const now = new Date().toISOString();
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        a: { type: 'a', message: 'a', count: 5, lastSeen: now },
        b: { type: 'b', message: 'b', count: 4, lastSeen: now },
        c: { type: 'c', message: 'c', count: 3, lastSeen: now },
      }),
    });

    const result = await getTopIssues('proj1', 2);
    expect(result.length).toBe(2);
  });
});

// ─── cross-project-intelligence ──────────────────────────────────────
describe('cross-project-intelligence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SYNC_THRESHOLD defaults to 0.6', () => {
    expect(SYNC_THRESHOLD).toBe(0.6);
  });

  it('calculateSimilarity returns 0 for empty patterns', () => {
    expect(calculateSimilarity([], [])).toBe(0);
    expect(calculateSimilarity(null, null)).toBe(0);
  });

  it('calculateSimilarity returns 1 for identical patterns', () => {
    const patterns = [{ fileTypes: ['js', 'test'] }];
    expect(calculateSimilarity(patterns, patterns)).toBe(1);
  });

  it('calculateSimilarity returns value between 0 and 1', () => {
    const a = [{ fileTypes: ['js', 'ts'] }];
    const b = [{ fileTypes: ['js', 'py'] }];
    const sim = calculateSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
    // Jaccard: intersection={js}=1, union={js,ts,py}=3 => 1/3
    expect(sim).toBeCloseTo(1 / 3);
  });

  it('syncPatterns syncs when similarity >= threshold', async () => {
    const patterns = [{ fileTypes: ['js'], learnedAt: '2026-01-01T00:00:00Z' }];
    mockOnce
      .mockResolvedValueOnce({ val: () => patterns }) // source
      .mockResolvedValueOnce({ val: () => patterns }); // target (same = similarity 1.0)

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(true);
    expect(result.similarity).toBe(1);
  });

  it('syncPatterns skips when similarity < threshold', async () => {
    mockOnce
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['js'] }] })
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['py', 'rb', 'go'] }] });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(false);
    // Jaccard: intersection={}, union={js,py,rb,go}=4 => 0/4=0
    expect(result.similarity).toBeLessThan(0.6);
  });

  it('syncPatterns handles empty source gracefully', async () => {
    mockOnce
      .mockResolvedValueOnce({ val: () => null })
      .mockResolvedValueOnce({ val: () => [{ fileTypes: ['js'] }] });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(false);
    expect(result.similarity).toBe(0);
  });

  it('syncPatterns merges non-duplicate patterns', async () => {
    const source = [
      { fileTypes: ['js'], learnedAt: '2026-01-01T00:00:00Z' },
      { fileTypes: ['js'], learnedAt: '2026-01-02T00:00:00Z' },
    ];
    const target = [
      { fileTypes: ['js'], learnedAt: '2026-01-01T00:00:00Z' },
    ];

    mockOnce
      .mockResolvedValueOnce({ val: () => source })
      .mockResolvedValueOnce({ val: () => target });

    const result = await syncPatterns('projA', 'projB');
    expect(result.synced).toBe(true);
    expect(result.mergedCount).toBe(2); // 1 existing + 1 new
  });
});
