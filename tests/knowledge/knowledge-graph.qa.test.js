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

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

const mockConfig = {
  knowledgeLocalDir: '.remoduler/knowledge',
  knowledgeMaxEntries: 200,
};

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
}));

const { KnowledgeGraph } = await import('../../src/knowledge/knowledge-graph.js');

// ── QA Tests ─────────────────────────────────────────────────────────
describe('KnowledgeGraph — QA acceptance tests', () => {
  let kg;

  beforeEach(() => {
    vi.clearAllMocks();
    kg = new KnowledgeGraph();
    mockConfig.knowledgeMaxEntries = 200;
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockOnce.mockResolvedValue({ val: () => [] });
  });

  // ─── AC1: Almacena coderBrief, reviewerBrief, moduleLessons, testingPatterns
  describe('AC1 — stores all four entry types', () => {
    const types = ['coderBrief', 'reviewerBrief', 'moduleLessons', 'testingPatterns'];

    for (const type of types) {
      it(`should store entry of type "${type}"`, async () => {
        await kg.addEntry('proj1', 'src/mod.js', type, { info: `test-${type}` });

        const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
        expect(written).toHaveLength(1);
        expect(written[0].type).toBe(type);
        expect(written[0].data.info).toBe(`test-${type}`);
        expect(written[0].createdAt).toBeDefined();
      });
    }

    it('should retrieve entries filtered by each type', async () => {
      const entries = types.map((t, i) => ({
        type: t,
        data: { idx: i },
        createdAt: `2025-01-0${i + 1}`,
      }));
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      for (const type of types) {
        const result = await kg.getEntries('proj1', 'src/mod.js', type);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe(type);
      }
    });
  });

  // ─── AC2: Scoped por module/file path
  describe('AC2 — scoped by module/file path', () => {
    it('should use sanitized scope in local file path', async () => {
      await kg.addEntry('proj1', 'src/auth/login.js', 'coderBrief', { x: 1 });

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('src_auth_login_js.json'),
        expect.any(String),
        'utf-8',
      );
    });

    it('should use sanitized scope in Firebase path', async () => {
      await kg.addEntry('proj1', 'src/auth/login.js', 'coderBrief', { x: 1 });

      expect(mockRef).toHaveBeenCalledWith(
        'intelligence/proj1/knowledge/src_auth_login_js',
      );
    });

    it('should isolate entries between different scopes', async () => {
      // Scope A entries
      const scopeAEntries = [{ type: 'coderBrief', data: { scope: 'A' }, createdAt: '2025-01-01' }];
      // Scope B entries
      const scopeBEntries = [{ type: 'moduleLessons', data: { scope: 'B' }, createdAt: '2025-01-01' }];

      mockReadFile.mockImplementation((path) => {
        if (path.includes('src_auth_js')) return Promise.resolve(JSON.stringify(scopeAEntries));
        if (path.includes('src_utils_js')) return Promise.resolve(JSON.stringify(scopeBEntries));
        return Promise.reject(new Error('ENOENT'));
      });

      const resultA = await kg.getEntries('proj1', 'src/auth.js');
      const resultB = await kg.getEntries('proj1', 'src/utils.js');

      expect(resultA).toHaveLength(1);
      expect(resultA[0].data.scope).toBe('A');
      expect(resultB).toHaveLength(1);
      expect(resultB[0].data.scope).toBe('B');
    });

    it('should isolate entries between different projects', async () => {
      await kg.addEntry('projA', 'src/mod.js', 'coderBrief', { proj: 'A' });
      await kg.addEntry('projB', 'src/mod.js', 'coderBrief', { proj: 'B' });

      // Local paths should differ by projectId
      const call1Path = mockWriteFile.mock.calls[0][0];
      const call2Path = mockWriteFile.mock.calls[1][0];
      expect(call1Path).toContain('projA');
      expect(call2Path).toContain('projB');
      expect(call1Path).not.toBe(call2Path);

      // Firebase paths should differ by projectId
      const fbCall1 = mockRef.mock.calls[0][0];
      const fbCall2 = mockRef.mock.calls[1][0];
      expect(fbCall1).toContain('projA');
      expect(fbCall2).toContain('projB');
    });
  });

  // ─── AC3: Carga lessons basado en archivos del taskSpec
  describe('AC3 — loads lessons based on taskSpec files', () => {
    it('should load lessons for file path and its parent directory', async () => {
      const entries = [{ type: 'moduleLessons', data: { tip: 'use guards' }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.loadLessonsForFiles('proj1', ['src/auth/login.js']);

      // Should query both 'src/auth/login.js' and 'src/auth'
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should deduplicate scopes (same dir from multiple files)', async () => {
      const entries = [{ type: 'moduleLessons', data: {}, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      await kg.loadLessonsForFiles('proj1', [
        'src/auth/login.js',
        'src/auth/register.js',
      ]);

      // 'src/auth' should only be queried once (deduplicated via Set)
      // We expect: login.js, register.js, src/auth = 3 unique scopes
      // Each scope calls getEntries which calls _loadLocal
      const readPaths = mockReadFile.mock.calls.map(c => c[0]);
      const authDirCalls = readPaths.filter(p => p.endsWith('src_auth.json'));
      expect(authDirCalls).toHaveLength(1);
    });

    it('should handle mixed string and object file paths', async () => {
      const entries = [{ type: 'coderBrief', data: {}, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.loadLessonsForFiles('proj1', [
        'src/a.js',
        { path: 'src/b.js' },
      ]);

      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── AC4: Registra patterns de reviews exitosos
  describe('AC4 — records successful review patterns', () => {
    it('should save as testingPatterns with reviewOutcome=approved', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/auth.js', {
        cycles: 1,
        taskId: 'task-42',
        reviewer: 'agent-reviewer',
      });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
      expect(written[0].data.reviewOutcome).toBe('approved');
      expect(written[0].data.cycles).toBe(1);
      expect(written[0].data.taskId).toBe('task-42');
      expect(written[0].data.reviewer).toBe('agent-reviewer');
    });

    it('should preserve all reviewData fields', async () => {
      const reviewData = { cycles: 3, taskId: 't1', notes: 'clean code', extra: [1, 2] };
      await kg.recordSuccessfulReview('proj1', 'src/x.js', reviewData);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].data).toMatchObject(reviewData);
      expect(written[0].data.reviewOutcome).toBe('approved');
    });
  });

  // ─── AC5: Storage — JSON local + Firebase
  describe('AC5 — dual storage (local JSON + Firebase)', () => {
    it('should write to local JSON with correct path structure', async () => {
      await kg.addEntry('myProj', 'src/feature.js', 'coderBrief', { v: 1 });

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('myProj'),
        { recursive: true },
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('src_feature_js.json'),
        expect.any(String),
        'utf-8',
      );
    });

    it('should write to Firebase with correct ref path', async () => {
      await kg.addEntry('myProj', 'src/feature.js', 'coderBrief', { v: 1 });

      expect(mockRef).toHaveBeenCalledWith('intelligence/myProj/knowledge/src_feature_js');
      expect(mockSet).toHaveBeenCalled();
    });

    it('should use local as primary and Firebase as fallback on read', async () => {
      const localEntries = [{ type: 'coderBrief', data: { from: 'local' }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(localEntries));

      const result = await kg.getEntries('proj1', 'src/x.js');

      expect(result).toHaveLength(1);
      expect(result[0].data.from).toBe('local');
      // Firebase ref should NOT be called when local succeeds
      expect(mockRef).not.toHaveBeenCalled();
    });

    it('should fallback to Firebase when local returns empty array', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));
      const fbEntries = [{ type: 'coderBrief', data: { from: 'firebase' }, createdAt: '2025-01-01' }];
      mockOnce.mockResolvedValue({ val: () => fbEntries });

      const result = await kg.getEntries('proj1', 'src/x.js');

      expect(result).toHaveLength(1);
      expect(result[0].data.from).toBe('firebase');
      expect(mockRef).toHaveBeenCalled();
    });

    it('should save to both stores in parallel (Promise.allSettled)', async () => {
      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { v: 1 });

      // Both local and Firebase should be written
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('should handle undefined entries in filePaths array', async () => {
      const entries = [{ type: 'coderBrief', data: {}, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      // undefined items should be skipped (typeof undefined !== 'string')
      const result = await kg.loadLessonsForFiles('proj1', [undefined, 'src/a.js']);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle scope with special Firebase characters', async () => {
      await kg.addEntry('proj1', 'src/[utils]/file#1.js', 'coderBrief', { v: 1 });

      // sanitizeKey should replace . # $ / [ ]
      expect(mockRef).toHaveBeenCalledWith(
        expect.stringMatching(/^intelligence\/proj1\/knowledge\/src__utils__file_1_js$/),
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('src__utils__file_1_js.json'),
        expect.any(String),
        'utf-8',
      );
    });

    it('should handle loadLessonsForFiles with file at root level (dirname = ".")', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      const result = await kg.loadLessonsForFiles('proj1', ['file.js']);

      // Should only query 'file.js', not '.' (guarded by dir !== '.')
      expect(result).toEqual([]);
    });

    it('should handle FIFO trim on Firebase side', async () => {
      mockConfig.knowledgeMaxEntries = 2;

      const existing = [
        { type: 'a', data: {}, createdAt: '2025-01-01' },
        { type: 'b', data: {}, createdAt: '2025-01-02' },
      ];
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { new: true });

      // Firebase set should receive trimmed array
      const fbWritten = mockSet.mock.calls[0][0];
      expect(fbWritten).toHaveLength(2);
      expect(fbWritten[0].type).toBe('b');
      expect(fbWritten[1].type).toBe('coderBrief');
    });

    it('should survive both local and Firebase failing on addEntry', async () => {
      mockReadFile.mockRejectedValue(new Error('disk full'));
      mockWriteFile.mockRejectedValue(new Error('disk full'));
      mockOnce.mockRejectedValue(new Error('network error'));

      // Should not throw
      await expect(
        kg.addEntry('proj1', 'src/x.js', 'coderBrief', { v: 1 }),
      ).resolves.toBeUndefined();
    });

    it('should handle loadLessonsForFiles when getEntries throws for a scope', async () => {
      let callCount = 0;
      mockReadFile.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('corrupt file');
        return Promise.resolve(JSON.stringify([{ type: 'a', data: {}, createdAt: '2025-01-01' }]));
      });
      mockOnce.mockRejectedValue(new Error('Firebase down'));

      // Should not throw, should skip failed scope
      const result = await kg.loadLessonsForFiles('proj1', ['src/a.js', 'src/b.js']);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle object filePath without .path property', async () => {
      const result = await kg.loadLessonsForFiles('proj1', [{ name: 'no-path' }]);
      // Should not throw; object without .path is neither string nor has fp.path
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
