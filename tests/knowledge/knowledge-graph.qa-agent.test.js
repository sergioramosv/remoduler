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

const { KnowledgeGraph } = await import('../../src/knowledge/knowledge-graph.js');

// ── QA Agent Tests ──────────────────────────────────────────────────
describe('KnowledgeGraph — QA Agent tests', () => {
  let kg;

  beforeEach(() => {
    vi.clearAllMocks();
    kg = new KnowledgeGraph();
    mockConfig.knowledgeMaxEntries = 200;
    mockConfig.knowledgeLocalDir = '.remoduler/knowledge';
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockOnce.mockResolvedValue({ val: () => [] });
  });

  // ─── AC1: Almacena los 4 tipos — data integrity ───────────────────
  describe('[AC1] data integrity for all 4 types', () => {
    it('preserves complex nested data in coderBrief entries', async () => {
      const complexData = {
        summary: 'refactored auth',
        changes: [{ file: 'a.js', lines: [1, 5, 10] }],
        metadata: { nested: { deep: true } },
      };
      await kg.addEntry('proj1', 'src/auth.js', 'coderBrief', complexData);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].data).toEqual(complexData);
    });

    it('stores empty object as data without error', async () => {
      await kg.addEntry('proj1', 'src/x.js', 'moduleLessons', {});

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].data).toEqual({});
      expect(written[0].type).toBe('moduleLessons');
    });

    it('getEntries with unknown type returns empty array', async () => {
      const entries = [
        { type: 'coderBrief', data: {}, createdAt: '2025-01-01' },
        { type: 'moduleLessons', data: {}, createdAt: '2025-01-02' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.getEntries('proj1', 'src/x.js', 'nonExistentType');
      expect(result).toEqual([]);
    });
  });

  // ─── AC2: Scoped — path isolation and sanitization ─────────────────
  describe('[AC2] scope isolation edge cases', () => {
    it('empty string scope produces valid local path', () => {
      const path = kg._localPath('proj1', '');
      expect(path).toContain('.json');
      expect(typeof path).toBe('string');
    });

    it('scope with only special characters is fully sanitized', async () => {
      await kg.addEntry('proj1', '.#$/[]', 'coderBrief', { v: 1 });

      // All chars should be replaced with _
      expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/knowledge/______');
    });

    it('very long scope path does not crash', async () => {
      const longScope = 'a/'.repeat(100) + 'file.js';
      await kg.addEntry('proj1', longScope, 'coderBrief', { v: 1 });

      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalled();
    });
  });

  // ─── AC3: loadLessonsForFiles — comprehensive scenarios ────────────
  describe('[AC3] loadLessonsForFiles comprehensive', () => {
    it('returns empty array for empty filePaths array', async () => {
      const result = await kg.loadLessonsForFiles('proj1', []);
      expect(result).toEqual([]);
    });

    it('returns empty array for null filePaths', async () => {
      const result = await kg.loadLessonsForFiles('proj1', null);
      expect(result).toEqual([]);
    });

    it('returns empty array for undefined filePaths', async () => {
      const result = await kg.loadLessonsForFiles('proj1', undefined);
      expect(result).toEqual([]);
    });

    it('deeply nested path generates correct parent scope', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', ['src/modules/auth/handlers/login.js']);

      // Should query: exact path + parent dir 'src/modules/auth/handlers'
      const readPaths = mockReadFile.mock.calls.map(c => c[0]);
      const hasExact = readPaths.some(p => p.includes('src_modules_auth_handlers_login_js'));
      const hasParent = readPaths.some(p => p.includes('src_modules_auth_handlers.json'));
      expect(hasExact).toBe(true);
      expect(hasParent).toBe(true);
    });

    it('object with path property at root level skips parent "."', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', [{ path: 'index.js' }]);

      // Should only query 'index.js', not '.'
      const readPaths = mockReadFile.mock.calls.map(c => c[0]);
      expect(readPaths).toHaveLength(1);
      expect(readPaths[0]).toContain('index_js');
    });

    it('number values in filePaths are silently skipped', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([
        { type: 'moduleLessons', data: { tip: 'valid' }, createdAt: '2025-01-01' },
      ]));

      const result = await kg.loadLessonsForFiles('proj1', [123, 'src/valid.js']);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('boolean and null values in filePaths are silently skipped', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      const result = await kg.loadLessonsForFiles('proj1', [true, false, null, 'src/ok.js']);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── AC4: recordSuccessfulReview — edge cases ──────────────────────
  describe('[AC4] recordSuccessfulReview edge cases', () => {
    it('stores review with minimal data (empty object)', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/x.js', {});

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
      expect(written[0].data.reviewOutcome).toBe('approved');
    });

    it('preserves array values in reviewData', async () => {
      const reviewData = {
        filesChanged: ['a.js', 'b.js', 'c.js'],
        scores: [90, 95, 88],
      };
      await kg.recordSuccessfulReview('proj1', 'src/x.js', reviewData);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].data.filesChanged).toEqual(['a.js', 'b.js', 'c.js']);
      expect(written[0].data.scores).toEqual([90, 95, 88]);
    });
  });

  // ─── AC5: Dual storage — fallback and resilience ───────────────────
  describe('[AC5] dual storage fallback scenarios', () => {
    it('getEntries with type filter works on Firebase fallback data', async () => {
      // Local empty → fallback to Firebase
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const fbEntries = [
        { type: 'coderBrief', data: { v: 1 }, createdAt: '2025-01-01' },
        { type: 'moduleLessons', data: { v: 2 }, createdAt: '2025-01-02' },
        { type: 'testingPatterns', data: { v: 3 }, createdAt: '2025-01-03' },
      ];
      mockOnce.mockResolvedValue({ val: () => fbEntries });

      const result = await kg.getEntries('proj1', 'src/x.js', 'moduleLessons');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('moduleLessons');
    });

    it('local save failure does not prevent Firebase save', async () => {
      mockMkdir.mockRejectedValueOnce(new Error('permission denied'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { v: 1 });

      // Firebase should still be called
      expect(mockSet).toHaveBeenCalled();
    });

    it('Firebase save failure does not prevent local save', async () => {
      mockOnce.mockRejectedValue(new Error('network timeout'));

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { v: 1 });

      // Local should still be written
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('warns on save failure with KNOWLEDGE tag', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', {});

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('Knowledge save failed'),
        'KNOWLEDGE',
      );
    });

    it('local JSON with entries prevents Firebase read on getEntries', async () => {
      const localEntries = [
        { type: 'coderBrief', data: { from: 'local' }, createdAt: '2025-01-01' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(localEntries));

      await kg.getEntries('proj1', 'src/x.js');

      // Firebase should NOT be called
      expect(mockRef).not.toHaveBeenCalled();
      expect(mockOnce).not.toHaveBeenCalled();
    });
  });

  // ─── FIFO boundary conditions ──────────────────────────────────────
  describe('FIFO boundary conditions', () => {
    it('FIFO keeps the most recent entries (last N)', async () => {
      mockConfig.knowledgeMaxEntries = 2;

      const existing = [
        { type: 'a', data: { order: 1 }, createdAt: '2025-01-01' },
        { type: 'b', data: { order: 2 }, createdAt: '2025-01-02' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { order: 3 });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      // Should keep b (order 2) and new entry (order 3), drop a (order 1)
      expect(written).toHaveLength(2);
      expect(written[0].data.order).toBe(2);
      expect(written[1].data.order).toBe(3);
    });

    it('maxEntries=1 keeps only the newest entry', async () => {
      mockConfig.knowledgeMaxEntries = 1;

      const existing = [
        { type: 'old', data: {}, createdAt: '2025-01-01' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { newest: true });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].type).toBe('coderBrief');
      expect(written[0].data.newest).toBe(true);
    });
  });

  // ─── Combined AC flow ─────────────────────────────────────────────
  describe('Combined AC flow: store → load lessons → record review', () => {
    it('full lifecycle: add entries, load by files, record review', async () => {
      // Step 1: Add a moduleLessons entry
      await kg.addEntry('proj1', 'src/auth/login.js', 'moduleLessons', { lesson: 'validate input' });
      const step1Written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(step1Written[0].type).toBe('moduleLessons');

      // Step 2: Load lessons for files — should find the entry
      mockReadFile.mockResolvedValue(JSON.stringify(step1Written));
      const lessons = await kg.loadLessonsForFiles('proj1', ['src/auth/login.js']);
      expect(lessons.length).toBeGreaterThanOrEqual(1);
      expect(lessons.some(e => e.data.lesson === 'validate input')).toBe(true);

      // Step 3: Record a successful review
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });
      await kg.recordSuccessfulReview('proj1', 'src/auth/login.js', {
        cycles: 1,
        taskId: 'task-lifecycle',
      });
      const step3Written = JSON.parse(mockWriteFile.mock.calls[mockWriteFile.mock.calls.length - 1][1]);
      expect(step3Written[0].type).toBe('testingPatterns');
      expect(step3Written[0].data.reviewOutcome).toBe('approved');
      expect(step3Written[0].data.taskId).toBe('task-lifecycle');
    });
  });
});
