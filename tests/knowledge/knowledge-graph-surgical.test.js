import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  readFile: (...args) => mockReadFile(...args),
  writeFile: (...args) => mockWriteFile(...args),
  mkdir: (...args) => mockMkdir(...args),
}));

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

// Mock logger
const mockWarn = vi.fn();
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: (...args) => mockWarn(...args),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock config
const mockConfig = {
  knowledgeLocalDir: '.remoduler/knowledge',
  knowledgeMaxEntries: 200,
};

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
}));

const { KnowledgeGraph } = await import('../../src/knowledge/knowledge-graph.js');

describe('KnowledgeGraph — surgical tests', () => {
  let kg;

  beforeEach(() => {
    vi.clearAllMocks();
    kg = new KnowledgeGraph();
    mockConfig.knowledgeMaxEntries = 200;
    mockConfig.knowledgeLocalDir = '.remoduler/knowledge';
  });

  // ─── AC: Almacena los 4 tipos ─────────────────────────────────────
  describe('[AC] stores all 4 knowledge types', () => {
    it('stores reviewerBrief type correctly', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/api.js', 'reviewerBrief', { issues: ['naming'] });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('reviewerBrief');
      expect(written[0].data.issues).toEqual(['naming']);
    });

    it('stores testingPatterns type correctly', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/api.js', 'testingPatterns', { pattern: 'mock-db' });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
      expect(written[0].data.pattern).toBe('mock-db');
    });
  });

  // ─── AC: Scoped por module/file path ──────────────────────────────
  describe('[AC] scoped by module/file path', () => {
    it('sanitizes special chars in scope for local path', () => {
      const path = kg._localPath('proj1', 'src/auth/login.js');
      expect(path).toContain('src_auth_login_js.json');
      expect(path).not.toMatch(/[.#$\/\[\]]/g.source.replace('\\/', '/'));
    });

    it('sanitizes special chars in scope for Firebase ref', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/utils/helper.js', 'coderBrief', {});

      expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/knowledge/src_utils_helper_js');
    });

    it('handles scope with Firebase-forbidden chars: . # $ [ ]', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/[id]/#page.js', 'coderBrief', {});

      expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/knowledge/src__id___page_js');
    });

    it('different scopes produce different local files', () => {
      const pathA = kg._localPath('proj1', 'src/a.js');
      const pathB = kg._localPath('proj1', 'src/b.js');
      expect(pathA).not.toBe(pathB);
    });

    it('different projects produce different local dirs', () => {
      const pathA = kg._localPath('projA', 'src/x.js');
      const pathB = kg._localPath('projB', 'src/x.js');
      expect(pathA).not.toBe(pathB);
      expect(pathA).toContain('projA');
      expect(pathB).toContain('projB');
    });
  });

  // ─── AC: Carga lessons basado en archivos del taskSpec ────────────
  describe('[AC] loadLessonsForFiles — taskSpec-based loading', () => {
    it('queries both exact path and parent directory scope', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', ['src/auth/login.js']);

      // readFile should be called for both 'src/auth/login.js' and 'src/auth'
      const readPaths = mockReadFile.mock.calls.map(c => c[0]);
      const hasExact = readPaths.some(p => p.includes('src_auth_login_js'));
      const hasParent = readPaths.some(p => p.includes('src_auth.json'));
      expect(hasExact).toBe(true);
      expect(hasParent).toBe(true);
    });

    it('deduplicates scopes from files in the same directory', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', [
        'src/auth/login.js',
        'src/auth/logout.js',
      ]);

      // 'src/auth' should only be queried once (Set deduplication)
      const readPaths = mockReadFile.mock.calls.map(c => c[0]);
      const parentCalls = readPaths.filter(p => p.endsWith('src_auth.json'));
      expect(parentCalls).toHaveLength(1);
    });

    it('handles mixed string and object paths in same call', async () => {
      const entries = [{ type: 'moduleLessons', data: { tip: 'use guards' }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.loadLessonsForFiles('proj1', [
        'src/a.js',
        { path: 'src/b.js' },
      ]);

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('skips non-string/non-object entries without crashing', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      const result = await kg.loadLessonsForFiles('proj1', [42, null, undefined, 'src/valid.js']);
      // Should not throw, and should still process 'src/valid.js'
      expect(Array.isArray(result)).toBe(true);
    });

    it('skips failed scopes and continues with others', async () => {
      let callCount = 0;
      mockReadFile.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) throw new Error('disk error');
        return Promise.resolve(JSON.stringify([{ type: 'moduleLessons', data: {}, createdAt: '2025-01-01' }]));
      });
      mockOnce.mockRejectedValue(new Error('Firebase down'));

      const result = await kg.loadLessonsForFiles('proj1', ['src/fail.js', 'src/ok.js']);
      // Should still return entries from successful scope
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── AC: Registra patterns de reviews exitosos ────────────────────
  describe('[AC] recordSuccessfulReview', () => {
    it('includes reviewOutcome=approved plus all review data fields', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.recordSuccessfulReview('proj1', 'feature/auth', {
        cycles: 1,
        score: 95,
        filesChanged: ['src/auth.js'],
        taskId: 'task-99',
      });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
      expect(written[0].data).toMatchObject({
        reviewOutcome: 'approved',
        cycles: 1,
        score: 95,
        filesChanged: ['src/auth.js'],
        taskId: 'task-99',
      });
    });
  });

  // ─── AC: Dual storage JSON local + Firebase ───────────────────────
  describe('[AC] dual storage', () => {
    it('getEntries does NOT call Firebase when local has data', async () => {
      const entries = [{ type: 'coderBrief', data: {}, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      await kg.getEntries('proj1', 'src/x.js');

      expect(mockRef).not.toHaveBeenCalled();
    });

    it('addEntry logs warning but does not throw when local save fails', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await expect(kg.addEntry('proj1', 'src/x.js', 'coderBrief', {}))
        .resolves.not.toThrow();

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('Knowledge save failed'),
        'KNOWLEDGE',
      );
    });

    it('Firebase FIFO also trims to maxEntries', async () => {
      mockConfig.knowledgeMaxEntries = 2;
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const existing = [
        { type: 'a', data: {}, createdAt: '2025-01-01' },
        { type: 'b', data: {}, createdAt: '2025-01-02' },
      ];
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { new: true });

      // Firebase set should have been called with trimmed array
      const fbWritten = mockSet.mock.calls[0][0];
      expect(fbWritten).toHaveLength(2);
      expect(fbWritten[0].type).toBe('b');
      expect(fbWritten[1].type).toBe('coderBrief');
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────
  describe('edge cases', () => {
    it('uses default knowledgeMaxEntries=200 when config value is falsy', async () => {
      mockConfig.knowledgeMaxEntries = 0; // falsy

      const existing = Array.from({ length: 201 }, (_, i) => ({
        type: 'coderBrief', data: { i }, createdAt: '2025-01-01',
      }));
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { new: true });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      // 201 existing + 1 new = 202, trimmed to 200
      expect(written).toHaveLength(200);
    });

    it('createdAt timestamp is a valid ISO string', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', {});

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      const ts = written[0].createdAt;
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('loadLessonsForFiles with root-level file (dirname=".") skips parent scope', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', ['package.json']);

      // Only 'package.json' scope, not '.'
      const readPaths = mockReadFile.mock.calls.map(c => c[0]);
      expect(readPaths).toHaveLength(1);
      expect(readPaths[0]).toContain('package_json');
    });
  });
});
