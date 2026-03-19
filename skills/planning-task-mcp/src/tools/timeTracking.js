import { getById, update } from '../firebase.js';
import { config } from '../config.js';

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const timeTrackingTools = {
  list_time_entries: {
    description: 'Lista las entradas de tiempo de una tarea con la duración total calculada.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const task = await getById('tasks', taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const entries = task.timeEntries || [];
      const totalMs = entries.reduce((sum, e) => sum + ((e.endTime || 0) - (e.startTime || 0)), 0);

      return {
        taskId,
        taskTitle: task.title,
        entries: entries.sort((a, b) => (b.startTime || 0) - (a.startTime || 0)),
        totalMs,
        totalFormatted: formatDuration(totalMs),
        entryCount: entries.length,
      };
    },
  },

  create_time_entry: {
    description: 'Registra una entrada de tiempo en una tarea. startTime y endTime son timestamps en milisegundos.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        startTime: { type: 'number', description: 'Timestamp de inicio (ms epoch)' },
        endTime: { type: 'number', description: 'Timestamp de fin (ms epoch)' },
        userId: { type: 'string', description: 'UID del usuario' },
        userName: { type: 'string', description: 'Nombre del usuario' },
      },
      required: ['taskId', 'startTime', 'endTime'],
    },
    handler: async ({ taskId, startTime, endTime, userId, userName }) => {
      const task = await getById('tasks', taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };
      if (endTime <= startTime) return { error: 'endTime debe ser posterior a startTime' };

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const entries = task.timeEntries || [];
      const id = `te_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const entry = { id, startTime, endTime, userId: uid || '', userName: uname || '' };
      entries.push(entry);

      await update('tasks', taskId, { timeEntries: entries });
      const durationMs = endTime - startTime;
      return { id, message: `Tiempo registrado: ${formatDuration(durationMs)}`, entry };
    },
  },

  delete_time_entry: {
    description: 'Elimina una entrada de tiempo de una tarea.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        entryId: { type: 'string', description: 'ID de la entrada de tiempo a eliminar' },
      },
      required: ['taskId', 'entryId'],
    },
    handler: async ({ taskId, entryId }) => {
      const task = await getById('tasks', taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const entries = (task.timeEntries || []).filter(e => e.id !== entryId);
      if (entries.length === (task.timeEntries || []).length) {
        return { error: `Entrada de tiempo ${entryId} no encontrada en la tarea` };
      }

      await update('tasks', taskId, { timeEntries: entries });
      return { message: 'Entrada de tiempo eliminada' };
    },
  },
};
