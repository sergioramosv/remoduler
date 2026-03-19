import { getAll, getById, getDb } from '../firebase.js';
import { config } from '../config.js';

export const retrospectiveTools = {
  get_retro_notes: {
    description: 'Obtiene las notas de retrospectiva de un sprint (qué fue bien, qué mejorar).',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string', description: 'ID del sprint' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId }) => {
      const sprint = await getById('sprints', sprintId);
      if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };

      const snapshot = await getDb().ref(`retro-notes/${sprintId}`).once('value');
      const data = snapshot.val();
      return {
        sprintId,
        sprintName: sprint.name,
        notes: data || { wentWell: '', toImprove: '' },
      };
    },
  },

  save_retro_notes: {
    description: 'Guarda o actualiza las notas de retrospectiva de un sprint.',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string', description: 'ID del sprint' },
        wentWell: { type: 'string', description: 'Qué fue bien durante el sprint' },
        toImprove: { type: 'string', description: 'Qué se puede mejorar' },
        userId: { type: 'string', description: 'UID del usuario que guarda' },
      },
      required: ['sprintId', 'wentWell', 'toImprove'],
    },
    handler: async ({ sprintId, wentWell, toImprove, userId }) => {
      const sprint = await getById('sprints', sprintId);
      if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };

      const uid = userId || config.defaultUserId;
      await getDb().ref(`retro-notes/${sprintId}`).set({
        wentWell: wentWell || '',
        toImprove: toImprove || '',
        updatedAt: Date.now(),
        updatedBy: uid || '',
      });

      return { message: `Notas de retrospectiva guardadas para "${sprint.name}"` };
    },
  },

  get_sprint_retrospective: {
    description: 'Obtiene la retrospectiva completa de un sprint: notas + métricas (completion rate, carry-over, desglose por developer, velocidad).',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string', description: 'ID del sprint' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId }) => {
      const sprint = await getById('sprints', sprintId);
      if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };

      // Notes
      const notesSnap = await getDb().ref(`retro-notes/${sprintId}`).once('value');
      const notes = notesSnap.val() || { wentWell: '', toImprove: '' };

      // Metrics
      const allTasks = await getAll('tasks');
      const sprintTasks = allTasks.filter(t => t.sprintId === sprintId);
      const completed = sprintTasks.filter(t => t.status === 'done' || t.status === 'validated');
      const carryOver = sprintTasks.filter(t => t.status !== 'done' && t.status !== 'validated');
      const totalDevPoints = sprintTasks.reduce((sum, t) => sum + (t.devPoints || 0), 0);
      const completedDevPoints = completed.reduce((sum, t) => sum + (t.devPoints || 0), 0);
      const totalBizPoints = sprintTasks.reduce((sum, t) => sum + (t.bizPoints || 0), 0);
      const completedBizPoints = completed.reduce((sum, t) => sum + (t.bizPoints || 0), 0);
      const completionRate = sprintTasks.length > 0 ? Math.round((completed.length / sprintTasks.length) * 100) : 0;

      // Developer breakdown
      const devMap = {};
      for (const task of sprintTasks) {
        if (!task.developer) continue;
        if (!devMap[task.developer]) devMap[task.developer] = { total: 0, completed: 0, devPoints: 0 };
        devMap[task.developer].total++;
        if (task.status === 'done' || task.status === 'validated') {
          devMap[task.developer].completed++;
          devMap[task.developer].devPoints += task.devPoints || 0;
        }
      }

      return {
        sprint: { id: sprintId, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, status: sprint.status },
        notes,
        metrics: {
          totalTasks: sprintTasks.length,
          completedTasks: completed.length,
          carryOverTasks: carryOver.length,
          totalDevPoints,
          completedDevPoints,
          totalBizPoints,
          completedBizPoints,
          completionRate,
        },
        carryOver: carryOver.map(t => ({ id: t.id, title: t.title, status: t.status, devPoints: t.devPoints, developer: t.developer })),
        developerBreakdown: devMap,
      };
    },
  },
};
