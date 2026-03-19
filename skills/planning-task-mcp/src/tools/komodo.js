import { getAll } from '../firebase.js';

/**
 * Komodo orchestrator tools - exposed via MCP for external agents.
 */
export const komodoTools = {
  komodo_watch: {
    description: `Checks if the Komodo daemon/watch mode should start executing tasks.

Returns information about the current backlog status for a project:
- Number of to-do tasks available
- Whether there are eligible (unblocked) tasks
- Recommended action: 'execute' if tasks available, 'idle' if not

This tool is read-only and does NOT start the daemon. Use the CLI command 'komodo watch' to start the daemon.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'ID del proyecto a consultar',
        },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      const allTasks = await getAll('tasks');
      const projectTasks = allTasks.filter(t => t.projectId === projectId);
      const todoTasks = projectTasks.filter(t => t.status === 'to-do');

      if (todoTasks.length === 0) {
        return {
          status: 'idle',
          message: 'No hay tareas to-do en el backlog',
          todoCount: 0,
          eligibleCount: 0,
          recommendation: 'idle',
        };
      }

      // Check for blocked tasks
      const taskMap = new Map(projectTasks.map(t => [t.id, t]));
      let eligibleCount = 0;

      for (const task of todoTasks) {
        const blockers = Array.isArray(task.blockedBy) ? task.blockedBy : [];
        if (blockers.length === 0) {
          eligibleCount++;
          continue;
        }

        const allBlockersResolved = blockers.every(blockerId => {
          const blocker = taskMap.get(blockerId);
          return blocker && blocker.status === 'done';
        });

        if (allBlockersResolved) {
          eligibleCount++;
        }
      }

      return {
        status: eligibleCount > 0 ? 'tasks_available' : 'all_blocked',
        message: eligibleCount > 0
          ? `${eligibleCount} tarea(s) elegible(s) para ejecución`
          : `${todoTasks.length} tarea(s) to-do pero todas bloqueadas por dependencias`,
        todoCount: todoTasks.length,
        eligibleCount,
        recommendation: eligibleCount > 0 ? 'execute' : 'idle',
      };
    },
  },
};
