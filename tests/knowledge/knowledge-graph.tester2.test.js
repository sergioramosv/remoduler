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

// ── Tester2 — gap-filling surgical tests ────────────────────────────
describe('KnowledgeGraph — Tester2 surgical gap tests', () => {
  let kg;

  beforeEach(() => {
    vi.clearAllMocks();
    kg = new KnowledgeGraph();
    mockConfig.knowledgeMaxEntries = 200;
    mockConfig.knowledgeLocalDir = '.remoduler/knowledge';
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockOnce.mockResolvedValue({ val: () => [] });
  });

  // ─── AC1: Both local and Firebase receive identical entry object ───
  describe('[AC1] entry consistency across dual storage', () => {
    it('local and Firebase receive the same entry type, data, and createdAt', async () => {
      await kg.addEntry('proj1', 'src/mod.js', 'reviewerBrief', { issues: ['naming'] });

      const localEntry = JSON.parse(mockWriteFile.mock.calls[0][1])[0];
      const fbEntry = mockSet.mock.calls[0][0][0];

      expect(localEntry.type).toBe(fbEntry.type);
      expect(localEntry.data).toEqual(fbEntry.data);
      expect(localEntry.createdAt).toBe(fbEntry.createdAt);
    });
  });

  // ─── AC2: _localPath structure includes projectId subdirectory ─────
  describe('[AC2] local path structure', () => {
    it('local path has structure: dir/projectId/sanitizedScope.json', () => {
      const path = kg._localPath('my-proj', 'src/utils/helper.js');
      // Should contain dir, then projectId, then filename
      expect(path).toMatch(/knowledge/);
      expect(path).toContain('my-proj');
      expect(path).toMatch(/src_utils_helper_js\.json$/);
    });

    it('Firebase ref structure is intelligence/{projectId}/knowledge/{sanitizedKey}', async () => {
      await kg.addEntry('my-proj', 'src/utils/helper.js', 'coderBrief', {});

      expect(mockRef).toHaveBeenCalledWith('intelligence/my-proj/knowledge/src_utils_helper_js');
    });
  });

  // ─── AC3: loadLessonsForFiles with object having empty .path ───────
  describe('[AC3] loadLessonsForFiles edge cases', () => {
    it('object with empty string .path is processed without crash', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      const result = await kg.loadLessonsForFiles('proj1', [{ path: '' }]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('single file produces exactly 2 scopes (file + parent dir)', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', ['src/auth/login.js']);

      // Expect reads for: 'src/auth/login.js' and 'src/auth'
      expect(mockReadFile.mock.calls.length).toBe(2);
    });

    it('files sharing the same parent dir get deduplicated scopes', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      await kg.loadLessonsForFiles('proj1', [
        'src/auth/login.js',
        'src/auth/register.js',
        'src/auth/logout.js',
      ]);

      // 3 unique file scopes + 1 shared parent 'src/auth' = 4 unique scopes
      expect(mockReadFile.mock.calls.length).toBe(4);
    });
  });

  // ─── AC4: recordSuccessfulReview uses addEntry internally ──────────
  describe('[AC4] recordSuccessfulReview internals', () => {
    it('writes to both local and Firebase (dual storage via addEntry)', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/x.js', { cycles: 1 });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(1);
    });

    it('createdAt is set automatically by addEntry', async () => {
      await kg.recordSuccessfulReview('proj1', 'src/x.js', { cycles: 1 });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].createdAt).toBeDefined();
      expect(() => new Date(written[0].createdAt)).not.toThrow();
    });
  });

  // ─── AC5: _saveLocal writes pretty-printed JSON ────────────────────
  describe('[AC5] storage format', () => {
    it('_saveLocal writes JSON with 2-space indentation', async () => {
      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { v: 1 });

      const rawJson = mockWriteFile.mock.calls[0][1];
      // JSON.stringify(x, null, 2) produces indented output
      expect(rawJson).toContain('\n');
      expect(rawJson).toMatch(/^ {2}\{/m);
    });

    it('_loadFirebase returns Firebase data correctly shaped', async () => {
      const fbEntries = [
        { type: 'moduleLessons', data: { tip: 'guard' }, createdAt: '2025-06-01' },
      ];
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => fbEntries });

      const result = await kg.getEntries('proj1', 'src/x.js');
      expect(result).toEqual(fbEntries);
    });
  });

  // ─── Regression: FIFO trim applies independently to local and FB ───
  describe('FIFO independence between stores', () => {
    it('local and Firebase trim independently based on their own data', async () => {
      mockConfig.knowledgeMaxEntries = 2;

      const localExisting = [
        { type: 'a', data: {}, createdAt: '2025-01-01' },
        { type: 'b', data: {}, createdAt: '2025-01-02' },
      ];
      const fbExisting = [
        { type: 'x', data: {}, createdAt: '2025-01-01' },
      ];

      mockReadFile.mockResolvedValue(JSON.stringify(localExisting));
      mockOnce.mockResolvedValue({ val: () => [...fbExisting] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { new: true });

      // Local: 2 existing + 1 new = 3 > 2, trimmed to 2
      const localWritten = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(localWritten).toHaveLength(2);
      expect(localWritten[0].type).toBe('b');

      // Firebase: 1 existing + 1 new = 2, exactly at limit — no trim
      const fbWritten = mockSet.mock.calls[0][0];
      expect(fbWritten).toHaveLength(2);
      expect(fbWritten[0].type).toBe('x');
    });
  });

  // ─── Regression: getEntries without type returns full array ────────
  describe('getEntries returns all when no type filter', () => {
    it('returns all entry types intermixed when type param is omitted', async () => {
      const mixed = [
        { type: 'coderBrief', data: {}, createdAt: '2025-01-01' },
        { type: 'reviewerBrief', data: {}, createdAt: '2025-01-02' },
        { type: 'moduleLessons', data: {}, createdAt: '2025-01-03' },
        { type: 'testingPatterns', data: {}, createdAt: '2025-01-04' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(mixed));

      const result = await kg.getEntries('proj1', 'src/x.js');
      expect(result).toHaveLength(4);
      expect(result.map(e => e.type)).toEqual([
        'coderBrief', 'reviewerBrief', 'moduleLessons', 'testingPatterns',
      ]);
    });
  });
});
