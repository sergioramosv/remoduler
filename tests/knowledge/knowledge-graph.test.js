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
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
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

// Import after mocks
const { KnowledgeGraph } = await import('../../src/knowledge/knowledge-graph.js');

describe('KnowledgeGraph', () => {
  let kg;

  beforeEach(() => {
    vi.clearAllMocks();
    kg = new KnowledgeGraph();
    mockConfig.knowledgeMaxEntries = 200;
  });

  describe('addEntry', () => {
    it('should save to local and firebase', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.addEntry('proj1', 'src/auth.js', 'coderBrief', { summary: 'added login' });

      // Local: mkdir + writeFile
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('src_auth_js.json'),
        expect.any(String),
        'utf-8',
      );

      // Firebase
      expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/knowledge/src_auth_js');
      expect(mockSet).toHaveBeenCalled();

      // Verify entry shape
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].type).toBe('coderBrief');
      expect(written[0].data.summary).toBe('added login');
      expect(written[0].createdAt).toBeDefined();
    });

    it('should append to existing entries', async () => {
      const existing = [{ type: 'moduleLessons', data: { lesson: 'old' }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/auth.js', 'coderBrief', { summary: 'new' });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(2);
    });
  });

  describe('getEntries', () => {
    it('should return all entries for a scope', async () => {
      const entries = [
        { type: 'coderBrief', data: { s: 1 }, createdAt: '2025-01-01' },
        { type: 'moduleLessons', data: { s: 2 }, createdAt: '2025-01-02' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.getEntries('proj1', 'src/auth.js');
      expect(result).toHaveLength(2);
    });

    it('should filter by type when provided', async () => {
      const entries = [
        { type: 'coderBrief', data: { s: 1 }, createdAt: '2025-01-01' },
        { type: 'moduleLessons', data: { s: 2 }, createdAt: '2025-01-02' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.getEntries('proj1', 'src/auth.js', 'coderBrief');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('coderBrief');
    });

    it('should fallback to Firebase when local is empty', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const fbEntries = [{ type: 'coderBrief', data: {}, createdAt: '2025-01-01' }];
      mockOnce.mockResolvedValue({ val: () => fbEntries });

      const result = await kg.getEntries('proj1', 'src/auth.js');
      expect(result).toHaveLength(1);
      expect(mockRef).toHaveBeenCalledWith('intelligence/proj1/knowledge/src_auth_js');
    });
  });

  describe('loadLessonsForFiles', () => {
    it('should return empty array for no files', async () => {
      const result = await kg.loadLessonsForFiles('proj1', []);
      expect(result).toEqual([]);
    });

    it('should return empty array for null input', async () => {
      const result = await kg.loadLessonsForFiles('proj1', null);
      expect(result).toEqual([]);
    });

    it('should load entries matching by path and parent dir', async () => {
      const entries = [{ type: 'moduleLessons', data: { tip: 'use guards' }, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.loadLessonsForFiles('proj1', ['src/auth/login.js']);

      // Should query both 'src/auth/login.js' and 'src/auth'
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle object file paths with .path property', async () => {
      const entries = [{ type: 'coderBrief', data: {}, createdAt: '2025-01-01' }];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const result = await kg.loadLessonsForFiles('proj1', [{ path: 'src/utils.js' }]);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('recordSuccessfulReview', () => {
    it('should create a testingPatterns entry', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockResolvedValue({ val: () => [] });

      await kg.recordSuccessfulReview('proj1', 'feature/login', { cycles: 2, taskId: 'task-1' });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written[0].type).toBe('testingPatterns');
      expect(written[0].data.reviewOutcome).toBe('approved');
      expect(written[0].data.cycles).toBe(2);
    });
  });

  describe('FIFO limit', () => {
    it('should trim entries when exceeding maxEntries', async () => {
      mockConfig.knowledgeMaxEntries = 3;

      const existing = [
        { type: 'a', data: {}, createdAt: '2025-01-01' },
        { type: 'b', data: {}, createdAt: '2025-01-02' },
        { type: 'c', data: {}, createdAt: '2025-01-03' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(existing));
      mockOnce.mockResolvedValue({ val: () => [...existing] });

      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { new: true });

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(3);
      // First entry should be trimmed (FIFO)
      expect(written[0].type).toBe('b');
      expect(written[2].type).toBe('coderBrief');
    });
  });

  describe('error handling', () => {
    it('should handle Firebase save failure gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockRejectedValue(new Error('Firebase down'));

      // Should not throw
      await kg.addEntry('proj1', 'src/x.js', 'coderBrief', { s: 1 });

      // Local should still be written
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should handle local read failure and fallback to Firebase', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const fbEntries = [{ type: 'coderBrief', data: {}, createdAt: '2025-01-01' }];
      mockOnce.mockResolvedValue({ val: () => fbEntries });

      const result = await kg.getEntries('proj1', 'src/x.js');
      expect(result).toHaveLength(1);
    });

    it('should return empty when both local and firebase fail', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockOnce.mockRejectedValue(new Error('Firebase down'));

      const result = await kg.getEntries('proj1', 'src/x.js');
      expect(result).toEqual([]);
    });
  });
});
