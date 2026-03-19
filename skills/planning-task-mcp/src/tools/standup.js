import { getAll, getById } from '../firebase.js';

export const standupTools = {
  get_standup_data: {
    description: 'Obtiene los datos de daily standup de un proyecto: por cada developer muestra tareas de ayer (completadas <48h), hoy (in-progress) y bloqueadas.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const allTasks = (await getAll('tasks')).filter(t => t.projectId === projectId);
      const allUsers = await getAll('users');
      const usersMap = Object.fromEntries(allUsers.map(u => [u.id || u.uid, u]));
      const memberIds = Object.keys(project.members || {});

      const now = Date.now();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime();

      const developers = memberIds.map(memberId => {
        const user = usersMap[memberId];
        const devTasks = allTasks.filter(t => t.developer === memberId);

        // Yesterday: done/validated updated in last 48h
        const yesterdayTasks = devTasks.filter(t =>
          (t.status === 'done' || t.status === 'validated') && (t.updatedAt || 0) >= yesterdayStart
        );

        // Today: in-progress or to-validate
        const todayTasks = devTasks.filter(t => t.status === 'in-progress' || t.status === 'to-validate');

        // Blocked: tasks with unresolved blockers
        const blockedTasks = devTasks.filter(t => {
          if (t.status === 'done' || t.status === 'validated') return false;
          if (t.blockedBy && t.blockedBy.length > 0) {
            return t.blockedBy.some(blockId => {
              const blocker = allTasks.find(bt => bt.id === blockId);
              return blocker && blocker.status !== 'done' && blocker.status !== 'validated';
            });
          }
          return false;
        });

        return {
          userId: memberId,
          displayName: user?.displayName || memberId,
          yesterday: yesterdayTasks.map(t => ({ id: t.id, title: t.title, devPoints: t.devPoints })),
          today: todayTasks.map(t => ({ id: t.id, title: t.title, status: t.status, devPoints: t.devPoints })),
          blocked: blockedTasks.map(t => ({
            id: t.id,
            title: t.title,
            blockedBy: (t.blockedBy || []).map(bid => {
              const b = allTasks.find(bt => bt.id === bid);
              return { id: bid, title: b?.title || bid };
            }),
          })),
        };
      });

      const activeDevelopers = developers.filter(d => d.yesterday.length > 0 || d.today.length > 0 || d.blocked.length > 0);

      return {
        project: { id: projectId, name: project.name },
        date: new Date().toISOString().split('T')[0],
        developers: activeDevelopers,
        summary: {
          totalDevelopers: activeDevelopers.length,
          totalInProgress: developers.reduce((sum, d) => sum + d.today.length, 0),
          totalBlocked: developers.reduce((sum, d) => sum + d.blocked.length, 0),
          totalCompletedYesterday: developers.reduce((sum, d) => sum + d.yesterday.length, 0),
        },
      };
    },
  },
};
