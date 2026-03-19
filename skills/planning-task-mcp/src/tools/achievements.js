import { getAll, getById, getDb } from '../firebase.js';
import { config } from '../config.js';

const ACHIEVEMENT_DEFINITIONS = [
  // Productivity
  { id: 'first_task', title: 'Primera tarea', description: 'Completa tu primera tarea', icon: '🎯', category: 'productivity', condition: { type: 'tasks_completed', threshold: 1 } },
  { id: 'task_10', title: 'Productivo', description: 'Completa 10 tareas', icon: '⚡', category: 'productivity', condition: { type: 'tasks_completed', threshold: 10 } },
  { id: 'task_50', title: 'Imparable', description: 'Completa 50 tareas', icon: '🔥', category: 'productivity', condition: { type: 'tasks_completed', threshold: 50 } },
  { id: 'task_100', title: 'Centurion', description: 'Completa 100 tareas', icon: '💎', category: 'productivity', condition: { type: 'tasks_completed', threshold: 100 } },
  { id: 'sprint_champion', title: 'Sprint Champion', description: 'Completa mas tareas que nadie en un sprint', icon: '🏆', category: 'productivity', condition: { type: 'sprint_top', threshold: 1 } },
  { id: 'speed_demon', title: 'Speed Demon', description: 'Completa 5 tareas en un mismo dia', icon: '💨', category: 'productivity', condition: { type: 'speed_complete', threshold: 5 } },
  // Quality
  { id: 'bug_hunter', title: 'Bug Hunter', description: 'Reporta tu primer bug', icon: '🐛', category: 'quality', condition: { type: 'bugs_resolved', threshold: 1 } },
  { id: 'bug_squasher_10', title: 'Bug Squasher', description: 'Resuelve 10 bugs', icon: '🛡️', category: 'quality', condition: { type: 'bugs_resolved', threshold: 10 } },
  { id: 'reviewer', title: 'Code Reviewer', description: 'Completa 5 revisiones de codigo', icon: '🔍', category: 'quality', condition: { type: 'reviews_done', threshold: 5 } },
  // Collaboration
  { id: 'team_player', title: 'Team Player', description: 'Colabora como co-developer en 5 tareas', icon: '🤝', category: 'collaboration', condition: { type: 'tasks_completed', threshold: 5 } },
  // Consistency
  { id: 'streak_3', title: 'En racha', description: 'Completa tareas 3 dias seguidos', icon: '📈', category: 'consistency', condition: { type: 'daily_streak', threshold: 3 } },
  { id: 'streak_7', title: 'Semana perfecta', description: 'Completa tareas 7 dias seguidos', icon: '🌟', category: 'consistency', condition: { type: 'daily_streak', threshold: 7 } },
  { id: 'streak_14', title: 'Maquina imparable', description: 'Completa tareas 14 dias seguidos', icon: '👑', category: 'consistency', condition: { type: 'daily_streak', threshold: 14 } },
  { id: 'early_bird', title: 'Early Bird', description: 'Completa 10 tareas en un sprint', icon: '🐦', category: 'consistency', condition: { type: 'tasks_in_sprint', threshold: 10 } },
];

export const achievementTools = {
  list_user_achievements: {
    description: 'Lista todos los logros de un usuario (desbloqueados y bloqueados) con sus definiciones completas.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario. Si no se pasa, usa DEFAULT_USER_ID.' },
      },
    },
    handler: async ({ userId }) => {
      const uid = userId || config.defaultUserId;
      if (!uid) return { error: 'Se requiere userId o DEFAULT_USER_ID' };

      const snapshot = await getDb().ref(`userAchievements/${uid}`).once('value');
      const data = snapshot.val() || {};

      const unlocked = Object.values(data).map(ach => {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.id === ach.achievementId);
        return { ...def, ...ach, unlocked: true };
      });

      const locked = ACHIEVEMENT_DEFINITIONS
        .filter(d => !data[d.id])
        .map(d => ({ ...d, unlocked: false }));

      return {
        unlocked,
        locked,
        totalUnlocked: unlocked.length,
        totalAvailable: ACHIEVEMENT_DEFINITIONS.length,
      };
    },
  },

  evaluate_achievements: {
    description: 'Evalúa y desbloquea automáticamente logros para un usuario basándose en sus estadísticas actuales. Envía notificación al desbloquear.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        userId: { type: 'string', description: 'UID del usuario. Si no se pasa, usa DEFAULT_USER_ID.' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, userId }) => {
      const uid = userId || config.defaultUserId;
      if (!uid) return { error: 'Se requiere userId' };

      const allTasks = await getAll('tasks');
      const allBugs = await getAll('bugs');
      const tasksCompleted = allTasks.filter(t => t.developer === uid && t.status === 'done').length;
      const bugsResolved = allBugs.filter(b => b.assignedTo === uid && (b.status === 'resolved' || b.status === 'closed')).length;

      const snapshot = await getDb().ref(`userAchievements/${uid}`).once('value');
      const current = snapshot.val() || {};
      const newlyUnlocked = [];

      for (const def of ACHIEVEMENT_DEFINITIONS) {
        if (current[def.id]) continue;

        let shouldUnlock = false;
        switch (def.condition.type) {
          case 'tasks_completed':
            shouldUnlock = tasksCompleted >= def.condition.threshold;
            break;
          case 'bugs_resolved':
            shouldUnlock = bugsResolved >= def.condition.threshold;
            break;
          default:
            break;
        }

        if (shouldUnlock) {
          const achievement = { achievementId: def.id, unlockedAt: Date.now(), projectId };
          await getDb().ref(`userAchievements/${uid}/${def.id}`).set(achievement);
          newlyUnlocked.push({ ...def, ...achievement });

          try {
            const notifRef = getDb().ref(`notifications/${uid}`).push();
            await notifRef.set({
              id: notifRef.key,
              userId: uid,
              title: `Logro desbloqueado: ${def.icon} ${def.title}`,
              message: def.description,
              type: 'success',
              read: false,
              date: Date.now(),
            });
          } catch { /* silent */ }
        }
      }

      return {
        evaluated: ACHIEVEMENT_DEFINITIONS.length,
        newlyUnlocked: newlyUnlocked.length,
        achievements: newlyUnlocked,
        stats: { tasksCompleted, bugsResolved },
      };
    },
  },

  get_leaderboard: {
    description: 'Obtiene el leaderboard de un proyecto: ranking de miembros por puntos (devPoints completados + bugs*3 + logros*5).',
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

      const memberIds = Object.keys(project.members || {});
      const allTasks = (await getAll('tasks')).filter(t => t.projectId === projectId);
      const allBugs = (await getAll('bugs')).filter(b => b.projectId === projectId);
      const allUsers = await getAll('users');
      const usersMap = Object.fromEntries(allUsers.map(u => [u.id || u.uid, u]));

      const leaderboard = [];
      for (const memberId of memberIds) {
        const user = usersMap[memberId];
        const completedTasks = allTasks.filter(t => t.developer === memberId && t.status === 'done');
        const tasksCompleted = completedTasks.length;
        const totalDevPoints = completedTasks.reduce((sum, t) => sum + (t.devPoints || 0), 0);
        const bugsResolved = allBugs.filter(b => b.assignedTo === memberId && (b.status === 'resolved' || b.status === 'closed')).length;

        const achSnap = await getDb().ref(`userAchievements/${memberId}`).once('value');
        const achievementCount = Object.keys(achSnap.val() || {}).length;
        const totalPoints = totalDevPoints + bugsResolved * 3 + achievementCount * 5;

        leaderboard.push({
          userId: memberId,
          displayName: user?.displayName || memberId,
          photoURL: user?.photoURL || '',
          tasksCompleted,
          bugsResolved,
          achievementCount,
          totalDevPoints,
          totalPoints,
        });
      }

      return leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);
    },
  },
};
