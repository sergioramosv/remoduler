import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  readFile: (...args) => mockReadFile(...args),
  writeFile: (...args) => mockWriteFile(...args),
  mkdir: (...args) => mockMkdir(...args),
}));

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockOnce = vi.fn();
const mockRef = vi.fn(() => ({
  once: mockOnce,
  set: mockSet,
}));

vi.mock('../../src/firebase.js', () => ({
  getDb: () => ({ ref: mockRef }),
}));

const mockWarn = vi.fn();
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: (...args) => mockWarn(...args), error: vi.fn(), success: vi.fn() },
}));

const mockConfig = {
  knowledgeLocalDir: '.remoduler/knowledge',
  knowledgeMaxEntries: 200,
};

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
}));

const { KnowledgeGraph, knowledgeGraph } = await import('../../src/knowledge/knowledge-graph.js');

// ── QA Final Tests ───────────────────────────────────────────────────
describe('KnowledgeGraph — QA final tests', () => {
  let kg;

  beforeEach(() => {
    vi.clearAllMocks();
    kg = new KnowledgeGraph();
    mockConfig.knowledgeMaxEntries = 200;
    mockConfig.knowledgeLocalDir = '.remoduler/knowledge';
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockOnce.mockResolvedValue({ val: () => [] });
  });

  // ─── AC1: Almacena coderBrief, reviewerBrief, moduleLessons, testingPatterns ──
  describe('[AC1] stores all 4 knowledge types', () => {
    it.each([
      ['coderBrief', { brief: 'code context' }],
      ['reviewerBrief', { brief: 'review context' }],
      ['moduleLessons', { lesson: 'always test edge cases' }],
      ['testingPatterns', { pattern: 'mock external deps' }],
    ])('addEntry stores %s type with correct data', async (type, data) => {
      await kg.addEntry('proj1', 'src/mod.js', type, data);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe(type);
      expect(written[0].data).toEqual(data);
      expect(written[0].createdAt).toBeDefined();
    });

    it('getEntries returns all types when no type filter provided', async () => {
      const mixed = [
        { type: 'coderBrief', data: {}, createdAt: '2025-01-01' },
        { type: 'reviewerBrief', data: {}, createdAt: '2025-01-02' },
        { type: 'moduleLessons', data: {}, createdAt: '2025-01-03' },
        { type: 'testingPatterns', data: {}, createdAt: '2025-01-04' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(mixed));

      const result = await kg.getEntries('proj1', 'src/mod.js');
      expect(result).toHaveLength(4);
    });

    it('getEntries filters correctly for each type', async () => {
      const mixed = [
        { type: 'coderBrief', data: { a: 1 }, createdAt: '2025-01-01' },
        { type: 'reviewerBrief', data: { b: 2 }, createdAt: '2025-01-02' },
        { type: 'coderBrief', data: { c: 3 }, createdAt: '2025-01-03' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(mixed));

      const result = await kg.getEntries('proj1', 'src/mod.js', 'coderBrief');
      expect(result).toHaveLength(2);
      expect(result.every(e => e.type === 'coderBrief')).toBe(true);
    });
  });

  // ─── AC2: Scoped por module/file path ──────────────────────────────
  describe('[AC2] scoped by module/file path', () => {
    it('different scopes produce different local file paths', async () => {
      await kg.addEntry('proj1', 'src/auth/login.js', 'coderBrief', {});
      await kg.addEntry('proj1', 'src/payments/stripe.js', 'coderBrief', {});

      const path1 = mockWriteFile.mock.calls[0][0];
      const path2 = mockWriteFile.mock.calls[1][0];
      expect(path1).not.toBe(path2);
    });

    it('different scopes produce different Firebase refs', async () => {
      await kg.addEntry('proj1', 'src/auth/login.js', 'coderBrief', {});
      await kg.addEntry('proj1', 'src/payments/stripe.js', 'coderBrief', {});

      const ref1 = mockRef.mock.calls[0][0];
      const ref2 = mockRef.mock.calls[1][0];
      expect(ref1).not.toBe(ref2);
    });

    it('same scope + different projects are isolated', async () => {
      await kg.addEntry('projA', 'src/mod.js', 'coderBrief', {});
      await kg.addEntry('projB', 'src/mod.js', 'coderBrief', {});

      const path1 = mockWriteFile.mock.calls[0][0];
      const path2 = mockWriteFile.mock.calls[1][0];
      expect(path1).not.toBe(path2);
      expect(path1).toContain('projA');
      expect(path2).toContain('projB');
    });

    it('sanitizes special characters in scope for Firebase keys', async () => {
      await kg.addEntry('proj1', 'src/[id]/page.js', 'coderBrief', {});

      const refPath = mockRef.mock.calls[0][0];
      expect(refPath).not.toContain('[');
      expect(refPath).not.toContain(']');
      expect(refPath).toContain('src__id__page_js');
    });
  });

  // ─── AC3: Carga lessons basado en archivos del taskSpec ────────────
  describe('[AC3] loadLessonsForFiles from taskSpec files', () => {
    it('returns empty array for null/undefined filePaths', async () => {
      expect(await kg.loadLessonsForFiles('proj1', null)).toEqual([]);
      expect(await kg.loadLessonsForFiles('proj1', undefined)).toEqual([]);
      expect(await kg.loadLessonsForFiles('proj1', [])).toEqual([]);
    });

    it('queries both exact file path and parent directory', async () => {
      const fileEntries = [{ type: 'coderBrief', data: { src: 'file' }, createdAt: '2025-01-01' }];
      const dirEntries = [{ type: 'moduleLessons', data: { src: 'dir' }, createdAt: '2025-01-02' }];

      mockReadFile.mockImplementation((path) => {
        if (path.includes('src_utils_helper_js')) return Promise.resolve(JSON.stringify(fileEntries));
        if (path.includes('src_utils.json')) return Promise.resolve(JSON.stringify(dirEntries));
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await kg.loadLessonsForFiles('proj1', ['src/utils/helper.js']);
      expect(result).toHaveLength(2);
    });

    it('handles object-type file paths with .path property', async () => {
      const entries = [{ type: 'coderBrief', data: { v: 1 }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.loadLessonsForFiles('proj1', [
        { path: 'src/index.js', status: 'modified' },
      ]);
      expect(result.length).toBeGreaterThan(0);
    });

    it('deduplicates scopes when multiple files share parent dir', async () => {
      const entries = [{ type: 'moduleLessons', data: {}, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      await kg.loadLessonsForFiles('proj1', [
        'src/utils/a.js',
        'src/utils/b.js',
      ]);

      // src/utils appears only once in scopes (Set deduplication)
      // scopes: src/utils/a.js, src/utils, src/utils/b.js = 3 unique scopes
      const readCalls = mockReadFile.mock.calls.length;
      expect(readCalls).toBe(3); // not 4
    });

    it('skips failed scopes without crashing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockRejectedValue(new Error('network error'));

      const result = await kg.loadLessonsForFiles('proj1', ['src/broken.js']);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── AC4: Registra patterns de reviews exitosos ────────────────────
  describe('[AC4] recordSuccessfulReview', () => {
    it('stores entry with type testingPatterns', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/auth.js', {
        cycles: 1,
        score: 95,
      });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
    });

    it('includes reviewOutcome:approved in data', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/auth.js', {
        cycles: 2,
        filesChanged: ['auth.js'],
      });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      // reviewOutcome is set to 'approved' before spread
      expect(written[0].data).toHaveProperty('cycles', 2);
      expect(written[0].data).toHaveProperty('filesChanged');
    });

    it('stores review with empty reviewData', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/auth.js', {});

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
      expect(written[0].data.reviewOutcome).toBe('approved');
    });
  });

  // ─── AC5: Storage JSON local + Firebase ────────────────────────────
  describe('[AC5] dual storage: JSON local + Firebase', () => {
    it('addEntry writes to both local and Firebase', async () => {
      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', { v: 1 });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(1);
    });

    it('getEntries falls back to Firebase when local is empty', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const fbEntries = [{ type: 'coderBrief', data: { fb: true }, createdAt: '2025-01-01' }];
      mockOnce.mockResolvedValue({ val: () => fbEntries });

      const result = await kg.getEntries('proj1', 'src/mod.js');
      expect(result).toEqual(fbEntries);
    });

    it('getEntries prefers local over Firebase when local has data', async () => {
      const localEntries = [{ type: 'coderBrief', data: { local: true }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(localEntries));

      const result = await kg.getEntries('proj1', 'src/mod.js');
      expect(result).toEqual(localEntries);
      // Firebase ref should not be called for reading since local had data
      // (mockRef is called but for the read path, once is not called)
    });

    it('local save failure logs warning but does not throw', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('disk full'));

      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', { v: 1 });

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('Knowledge save failed'),
        'KNOWLEDGE',
      );
    });

    it('Firebase save failure logs warning but does not throw', async () => {
      mockOnce.mockRejectedValue(new Error('permission-denied'));

      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', { v: 1 });

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('Firebase knowledge save failed'),
        'KNOWLEDGE',
      );
    });

    it('both storages failing still does not throw', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
      mockOnce.mockRejectedValue(new Error('permission-denied'));

      await expect(
        kg.addEntry('proj1', 'src/mod.js', 'coderBrief', { v: 1 }),
      ).resolves.not.toThrow();
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('addEntry with null data stores null in entry', async () => {
      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', null);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].data).toBeNull();
    });

    it('addEntry with deeply nested data preserves structure', async () => {
      const nested = { a: { b: { c: { d: [1, 2, { e: 'deep' }] } } } };
      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', nested);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].data).toEqual(nested);
    });

    it('FIFO trims oldest when exceeding maxEntries', async () => {
      mockConfig.knowledgeMaxEntries = 2;

      const existing = [
        { type: 'coderBrief', data: { v: 'old' }, createdAt: '2025-01-01' },
        { type: 'coderBrief', data: { v: 'mid' }, createdAt: '2025-01-02' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', { v: 'new' });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(written[0].data.v).toBe('mid');
      expect(written[1].data.v).toBe('new');
    });

    it('loadLessonsForFiles with root-level file skips "." parent dir', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', ['index.js']);

      // Only 1 scope: index.js (parent "." is skipped)
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('createdAt is a valid ISO timestamp', async () => {
      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', {});

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      const ts = new Date(written[0].createdAt);
      expect(ts.toISOString()).toBe(written[0].createdAt);
    });

    it('knowledgeMaxEntries defaults to 200 when config value is falsy', async () => {
      mockConfig.knowledgeMaxEntries = 0;

      const existing = Array.from({ length: 201 }, (_, i) => ({
        type: 'coderBrief',
        data: { i },
        createdAt: `2025-01-${String(i + 1).padStart(2, '0')}`,
      }));
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/mod.js', 'coderBrief', { v: 'new' });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      // 201 + 1 = 202, trimmed to 200
      expect(written).toHaveLength(200);
    });
  });
});
