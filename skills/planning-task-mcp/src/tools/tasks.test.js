import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory store for tasks
let tasksStore = {};
let historyEntries = [];
let notificationEntries = [];

vi.mock('../firebase.js', () => ({
  getAll: vi.fn(async () => Object.entries(tasksStore).map(([id, data]) => ({ id, ...data }))),
  getById: vi.fn(async (path, id) => {
    if (path === 'tasks') {
      const data = tasksStore[id];
      return data ? { id, ...data } : null;
    }
    if (path === 'projects') return { id, name: 'Test Project' };
    if (path === 'sprints') return { id, name: 'Sprint 1' };
    return null;
  }),
  create: vi.fn(async (path, data) => {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    tasksStore[id] = { ...data };
    return id;
  }),
  update: vi.fn(async (path, id, data) => {
    if (tasksStore[id]) {
      tasksStore[id] = { ...tasksStore[id], ...data };
    }
  }),
  remove: vi.fn(async (path, id) => {
    delete tasksStore[id];
  }),
  getDb: vi.fn(() => ({
    ref: () => ({
      push: () => {
        const key = `hist-${Date.now()}`;
        return {
          key,
          set: async (data) => { historyEntries.push(data); },
        };
      },
      remove: async () => {},
    }),
  })),
}));

vi.mock('../config.js', () => ({
  config: {
    defaultUserId: 'user1',
    defaultUserName: 'Test User',
  },
}));

import { taskTools, hasCircularDependency, validateTaskIds } from './tasks.js';

const PROJECT_ID = 'proj-1';

function createTestTask(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    title: 'Test Task',
    userStory: { who: 'As a user', what: 'I want to test', why: 'To verify it works' },
    acceptanceCriteria: ['It works'],
    bizPoints: 5,
    devPoints: 3,
    tests: [{ description: 'Unit test', type: 'unit', status: 'pending' }],
    ...overrides,
  };
}

describe('tasks - dependency model', () => {
  beforeEach(() => {
    tasksStore = {};
    historyEntries = [];
    notificationEntries = [];
    vi.clearAllMocks();
  });

  // ── create_task with new fields ──────────────────────

  describe('create_task', () => {
    it('creates a task with default empty dependency fields', async () => {
      const result = await taskTools.create_task.handler(createTestTask());
      expect(result.id).toBeDefined();
      expect(result.task.parentTaskId).toBe('');
      expect(result.task.blockedBy).toEqual([]);
      expect(result.task.blocks).toEqual([]);
      expect(result.task.subtaskIds).toEqual([]);
      expect(result.task.decomposed).toBe(false);
    });

    it('creates a task with parentTaskId and updates parent subtaskIds', async () => {
      // Create parent task first
      const parent = await taskTools.create_task.handler(createTestTask({ title: 'Parent Task' }));
      const parentId = parent.id;

      // Create subtask
      const subtask = await taskTools.create_task.handler(createTestTask({
        title: 'Subtask 1',
        parentTaskId: parentId,
      }));

      expect(subtask.task.parentTaskId).toBe(parentId);
      // Parent should have the subtask in subtaskIds
      expect(tasksStore[parentId].subtaskIds).toContain(subtask.id);
    });

    it('creates a task with blockedBy and updates inverse blocks', async () => {
      const blocker = await taskTools.create_task.handler(createTestTask({ title: 'Blocker' }));
      const blockerId = blocker.id;

      const blocked = await taskTools.create_task.handler(createTestTask({
        title: 'Blocked Task',
        blockedBy: [blockerId],
      }));

      expect(blocked.task.blockedBy).toEqual([blockerId]);
      // Blocker should have the blocked task in its blocks
      expect(tasksStore[blockerId].blocks).toContain(blocked.id);
    });

    it('creates a task with blocks and updates inverse blockedBy', async () => {
      const dependent = await taskTools.create_task.handler(createTestTask({ title: 'Dependent' }));
      const dependentId = dependent.id;

      const blocker = await taskTools.create_task.handler(createTestTask({
        title: 'Blocker',
        blocks: [dependentId],
      }));

      expect(blocker.task.blocks).toEqual([dependentId]);
      // Dependent should have the blocker in its blockedBy
      expect(tasksStore[dependentId].blockedBy).toContain(blocker.id);
    });

    it('rejects create with invalid parentTaskId', async () => {
      const result = await taskTools.create_task.handler(createTestTask({
        parentTaskId: 'nonexistent-id',
      }));
      expect(result.error).toMatch(/Tarea padre nonexistent-id no encontrada/);
    });

    it('rejects create with invalid blockedBy IDs', async () => {
      const result = await taskTools.create_task.handler(createTestTask({
        blockedBy: ['nonexistent-1', 'nonexistent-2'],
      }));
      expect(result.error).toMatch(/Tareas en blockedBy no encontradas/);
    });

    it('rejects create with invalid blocks IDs', async () => {
      const result = await taskTools.create_task.handler(createTestTask({
        blocks: ['nonexistent-1'],
      }));
      expect(result.error).toMatch(/Tareas en blocks no encontradas/);
    });

    it('detects circular dependency when blockedBy and blocks overlap', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({ title: 'Task A' }));

      const result = await taskTools.create_task.handler(createTestTask({
        title: 'Task B',
        blockedBy: [taskA.id],
        blocks: [taskA.id],
      }));

      expect(result.error).toMatch(/Dependencia circular detectada/);
    });

    it('detects transitive circular dependency with blockedBy + blocks', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({ title: 'Task A' }));
      const taskB = await taskTools.create_task.handler(createTestTask({
        title: 'Task B',
        blockedBy: [taskA.id],
      }));

      // Create C that blocks A and is blockedBy B → cycle: A→B→C→A
      const result = await taskTools.create_task.handler(createTestTask({
        title: 'Task C',
        blockedBy: [taskB.id],
        blocks: [taskA.id],
      }));

      expect(result.error).toMatch(/Dependencia circular detectada/);
    });
  });

  // ── update_task with dependency fields ────────────────

  describe('update_task', () => {
    it('updates blockedBy on a task', async () => {
      const task1 = await taskTools.create_task.handler(createTestTask({ title: 'Task 1' }));
      const task2 = await taskTools.create_task.handler(createTestTask({ title: 'Task 2' }));

      const result = await taskTools.update_task.handler({
        taskId: task2.id,
        blockedBy: [task1.id],
      });

      expect(result.message).toMatch(/actualizada/);
      expect(tasksStore[task2.id].blockedBy).toEqual([task1.id]);
    });

    it('updates blocks on a task', async () => {
      const task1 = await taskTools.create_task.handler(createTestTask({ title: 'Task 1' }));
      const task2 = await taskTools.create_task.handler(createTestTask({ title: 'Task 2' }));

      const result = await taskTools.update_task.handler({
        taskId: task1.id,
        blocks: [task2.id],
      });

      expect(result.message).toMatch(/actualizada/);
      expect(tasksStore[task1.id].blocks).toEqual([task2.id]);
    });

    it('updates parentTaskId on a task', async () => {
      const parent = await taskTools.create_task.handler(createTestTask({ title: 'Parent' }));
      const child = await taskTools.create_task.handler(createTestTask({ title: 'Child' }));

      const result = await taskTools.update_task.handler({
        taskId: child.id,
        parentTaskId: parent.id,
      });

      expect(result.message).toMatch(/actualizada/);
      expect(tasksStore[child.id].parentTaskId).toBe(parent.id);
    });

    it('updates decomposed flag on a task', async () => {
      const task = await taskTools.create_task.handler(createTestTask({ title: 'Task' }));

      const result = await taskTools.update_task.handler({
        taskId: task.id,
        decomposed: true,
      });

      expect(result.message).toMatch(/actualizada/);
      expect(tasksStore[task.id].decomposed).toBe(true);
    });

    it('rejects update with invalid blockedBy IDs', async () => {
      const task = await taskTools.create_task.handler(createTestTask({ title: 'Task' }));

      const result = await taskTools.update_task.handler({
        taskId: task.id,
        blockedBy: ['nonexistent-id'],
      });

      expect(result.error).toMatch(/Tareas en blockedBy no encontradas/);
    });

    it('rejects update with invalid blocks IDs', async () => {
      const task = await taskTools.create_task.handler(createTestTask({ title: 'Task' }));

      const result = await taskTools.update_task.handler({
        taskId: task.id,
        blocks: ['nonexistent-id'],
      });

      expect(result.error).toMatch(/Tareas en blocks no encontradas/);
    });

    it('syncs inverse blocks when updating blockedBy', async () => {
      const task1 = await taskTools.create_task.handler(createTestTask({ title: 'Task 1' }));
      const task2 = await taskTools.create_task.handler(createTestTask({ title: 'Task 2' }));

      await taskTools.update_task.handler({
        taskId: task2.id,
        blockedBy: [task1.id],
      });

      // task1 should have task2 in its blocks
      expect(tasksStore[task1.id].blocks).toContain(task2.id);

      // Now remove the dependency
      await taskTools.update_task.handler({
        taskId: task2.id,
        blockedBy: [],
      });

      // task1 should no longer have task2 in blocks
      expect(tasksStore[task1.id].blocks).not.toContain(task2.id);
    });

    it('syncs inverse blockedBy when updating blocks', async () => {
      const task1 = await taskTools.create_task.handler(createTestTask({ title: 'Task 1' }));
      const task2 = await taskTools.create_task.handler(createTestTask({ title: 'Task 2' }));

      await taskTools.update_task.handler({
        taskId: task1.id,
        blocks: [task2.id],
      });

      // task2 should have task1 in its blockedBy
      expect(tasksStore[task2.id].blockedBy).toContain(task1.id);

      // Now remove the dependency
      await taskTools.update_task.handler({
        taskId: task1.id,
        blocks: [],
      });

      // task2 should no longer have task1 in blockedBy
      expect(tasksStore[task2.id].blockedBy).not.toContain(task1.id);
    });

    it('syncs parentTaskId: removes from old parent, adds to new parent', async () => {
      const parent1 = await taskTools.create_task.handler(createTestTask({ title: 'Parent 1' }));
      const parent2 = await taskTools.create_task.handler(createTestTask({ title: 'Parent 2' }));
      const child = await taskTools.create_task.handler(createTestTask({
        title: 'Child',
        parentTaskId: parent1.id,
      }));

      expect(tasksStore[parent1.id].subtaskIds).toContain(child.id);

      // Move child to parent2
      await taskTools.update_task.handler({
        taskId: child.id,
        parentTaskId: parent2.id,
      });

      // parent1 should no longer have child
      expect(tasksStore[parent1.id].subtaskIds).not.toContain(child.id);
      // parent2 should have child
      expect(tasksStore[parent2.id].subtaskIds).toContain(child.id);
    });

    it('rejects update with invalid parentTaskId', async () => {
      const task = await taskTools.create_task.handler(createTestTask({ title: 'Task' }));

      const result = await taskTools.update_task.handler({
        taskId: task.id,
        parentTaskId: 'nonexistent-id',
      });

      expect(result.error).toMatch(/Tarea padre nonexistent-id no encontrada/);
    });
  });

  // ── Circular dependency detection ─────────────────────

  describe('circular dependency detection', () => {
    it('detects direct circular dependency (A blocked by B, B blocked by A)', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({ title: 'Task A' }));
      const taskB = await taskTools.create_task.handler(createTestTask({
        title: 'Task B',
        blockedBy: [taskA.id],
      }));

      // Try to make A blocked by B (circular)
      const result = await taskTools.update_task.handler({
        taskId: taskA.id,
        blockedBy: [taskB.id],
      });

      expect(result.error).toMatch(/Dependencia circular detectada/);
    });

    it('detects transitive circular dependency (A→B→C→A)', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({ title: 'Task A' }));
      const taskB = await taskTools.create_task.handler(createTestTask({
        title: 'Task B',
        blockedBy: [taskA.id],
      }));
      const taskC = await taskTools.create_task.handler(createTestTask({
        title: 'Task C',
        blockedBy: [taskB.id],
      }));

      // Try to make A blocked by C (circular: A→B→C→A)
      const result = await taskTools.update_task.handler({
        taskId: taskA.id,
        blockedBy: [taskC.id],
      });

      expect(result.error).toMatch(/Dependencia circular detectada/);
    });

    it('allows non-circular dependencies', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({ title: 'Task A' }));
      const taskB = await taskTools.create_task.handler(createTestTask({ title: 'Task B' }));
      const taskC = await taskTools.create_task.handler(createTestTask({ title: 'Task C' }));

      // A→B→C (linear chain, no cycle)
      await taskTools.update_task.handler({ taskId: taskB.id, blockedBy: [taskA.id] });
      const result = await taskTools.update_task.handler({ taskId: taskC.id, blockedBy: [taskB.id] });

      expect(result.error).toBeUndefined();
      expect(result.message).toMatch(/actualizada/);
    });
  });

  // ── hasCircularDependency helper ──────────────────────

  describe('hasCircularDependency', () => {
    it('returns true when fromId equals toId', async () => {
      expect(await hasCircularDependency('x', 'x')).toBe(true);
    });

    it('returns false when toId task does not exist', async () => {
      expect(await hasCircularDependency('a', 'nonexistent')).toBe(false);
    });
  });

  // ── validateTaskIds helper ────────────────────────────

  describe('validateTaskIds', () => {
    it('returns valid when all IDs exist in the project', async () => {
      const t1 = await taskTools.create_task.handler(createTestTask({ title: 'T1' }));
      const t2 = await taskTools.create_task.handler(createTestTask({ title: 'T2' }));

      const result = await validateTaskIds([t1.id, t2.id], PROJECT_ID);
      expect(result.valid).toBe(true);
    });

    it('returns invalid with missing IDs', async () => {
      const result = await validateTaskIds(['nonexistent-1', 'nonexistent-2'], PROJECT_ID);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['nonexistent-1', 'nonexistent-2']);
    });
  });

  // ── list_subtasks ─────────────────────────────────────

  describe('list_subtasks', () => {
    it('returns subtasks for a parent task', async () => {
      const parent = await taskTools.create_task.handler(createTestTask({ title: 'Parent' }));
      const sub1 = await taskTools.create_task.handler(createTestTask({
        title: 'Sub 1',
        parentTaskId: parent.id,
      }));
      const sub2 = await taskTools.create_task.handler(createTestTask({
        title: 'Sub 2',
        parentTaskId: parent.id,
      }));

      const result = await taskTools.list_subtasks.handler({ taskId: parent.id });

      expect(result.parentTaskId).toBe(parent.id);
      expect(result.total).toBe(2);
      expect(result.subtasks.map(s => s.id)).toContain(sub1.id);
      expect(result.subtasks.map(s => s.id)).toContain(sub2.id);
    });

    it('returns empty when task has no subtasks', async () => {
      const task = await taskTools.create_task.handler(createTestTask({ title: 'Lonely Task' }));

      const result = await taskTools.list_subtasks.handler({ taskId: task.id });

      expect(result.subtasks).toEqual([]);
      expect(result.message).toMatch(/no tiene subtareas/);
    });

    it('returns error for non-existent task', async () => {
      const result = await taskTools.list_subtasks.handler({ taskId: 'nonexistent' });
      expect(result.error).toMatch(/no encontrada/);
    });
  });

  // ── change_task_status: clean blockedBy on done ───────

  describe('change_task_status - blockedBy cleanup', () => {
    it('removes completed task from blockedBy of dependent tasks', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({
        title: 'Task A',
        tests: [{ description: 'test', type: 'unit', status: 'passed' }],
      }));
      const taskB = await taskTools.create_task.handler(createTestTask({
        title: 'Task B',
        blockedBy: [taskA.id],
      }));

      // Task A blocks Task B (inverse was set automatically)
      expect(tasksStore[taskA.id].blocks).toContain(taskB.id);
      expect(tasksStore[taskB.id].blockedBy).toContain(taskA.id);

      // Mark Task A as done
      const result = await taskTools.change_task_status.handler({
        taskId: taskA.id,
        newStatus: 'done',
      });

      expect(result.message).toMatch(/done/);
      // Task B should no longer be blocked by Task A
      expect(tasksStore[taskB.id].blockedBy).not.toContain(taskA.id);
    });

    it('handles chain: completing A unblocks B, then completing B unblocks C', async () => {
      const taskA = await taskTools.create_task.handler(createTestTask({
        title: 'Task A',
        tests: [{ description: 'test', type: 'unit', status: 'passed' }],
      }));
      const taskB = await taskTools.create_task.handler(createTestTask({
        title: 'Task B',
        blockedBy: [taskA.id],
        tests: [{ description: 'test', type: 'unit', status: 'passed' }],
      }));
      const taskC = await taskTools.create_task.handler(createTestTask({
        title: 'Task C',
        blockedBy: [taskB.id],
      }));

      // Complete A → unblocks B
      await taskTools.change_task_status.handler({ taskId: taskA.id, newStatus: 'done' });
      expect(tasksStore[taskB.id].blockedBy).not.toContain(taskA.id);

      // Complete B → unblocks C
      await taskTools.change_task_status.handler({ taskId: taskB.id, newStatus: 'done' });
      expect(tasksStore[taskC.id].blockedBy).not.toContain(taskB.id);
    });
  });

  // ── list_tasks includes new fields ────────────────────

  describe('list_tasks - includes new fields', () => {
    it('returns tasks with parentTaskId, blockedBy, blocks, subtaskIds, decomposed', async () => {
      const parent = await taskTools.create_task.handler(createTestTask({ title: 'Parent' }));
      await taskTools.create_task.handler(createTestTask({
        title: 'Child',
        parentTaskId: parent.id,
      }));

      const tasks = await taskTools.list_tasks.handler({ projectId: PROJECT_ID });

      const parentTask = tasks.find(t => t.title === 'Parent');
      const childTask = tasks.find(t => t.title === 'Child');

      expect(parentTask.subtaskIds.length).toBe(1);
      expect(parentTask.decomposed).toBe(false);
      expect(childTask.parentTaskId).toBe(parent.id);
      expect(childTask.blockedBy).toEqual([]);
      expect(childTask.blocks).toEqual([]);
    });
  });
});
