import { getAll, getById } from '../firebase.js';

function calculatePriority(bizPoints, devPoints) {
  if (!devPoints || devPoints === 0) return 0;
  return Math.round((bizPoints / devPoints) * 10) / 10;
}

export const analyticsTools = {
  project_dashboard: {
    description: 'Obtiene métricas completas de un proyecto: tareas por estado, porcentaje de completado, carga de desarrolladores, progreso de sprints y distribución de bugs.',
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

      const [allTasks, allSprints, allBugs] = await Promise.all([
        getAll('tasks'),
        getAll('sprints'),
        getAll('bugs'),
      ]);

      const tasks = allTasks.filter(t => t.projectId === projectId);
      const sprints = allSprints.filter(s => s.projectId === projectId);
      const bugs = allBugs.filter(b => b.projectId === projectId);

      // Task metrics
      const total = tasks.length;
      const done = tasks.filter(t => t.status === 'done').length;
      const inProgress = tasks.filter(t => t.status === 'in-progress').length;
      const toValidate = tasks.filter(t => t.status === 'to-validate').length;
      const validated = tasks.filter(t => t.status === 'validated').length;
      const toDo = tasks.filter(t => t.status === 'to-do').length;
      const completionPercentage = total > 0 ? Math.round((done / total) * 100) : 0;

      // Developer metrics
      const developerMetrics = {};
      for (const task of tasks) {
        if (!task.developer) continue;
        if (!developerMetrics[task.developer]) {
          developerMetrics[task.developer] = { load: 0, completed: 0, pending: 0, inProgress: 0, totalTasks: 0 };
        }
        const dm = developerMetrics[task.developer];
        dm.totalTasks++;
        if (task.status === 'done') {
          dm.completed++;
        } else {
          dm.load += task.devPoints || 0;
          if (task.status === 'in-progress') dm.inProgress++;
          else dm.pending++;
        }
      }

      // Sprint metrics
      const sprintMetrics = sprints.map(sprint => {
        const sprintTasks = tasks.filter(t => t.sprintId === sprint.id);
        const sprintDone = sprintTasks.filter(t => t.status === 'done').length;
        const totalDevPoints = sprintTasks.reduce((sum, t) => sum + (t.devPoints || 0), 0);
        const completedDevPoints = sprintTasks.filter(t => t.status === 'done').reduce((sum, t) => sum + (t.devPoints || 0), 0);
        return {
          sprintId: sprint.id,
          name: sprint.name,
          status: sprint.status,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          totalTasks: sprintTasks.length,
          completedTasks: sprintDone,
          progress: sprintTasks.length > 0 ? Math.round((sprintDone / sprintTasks.length) * 100) : 0,
          totalDevPoints,
          completedDevPoints,
        };
      });

      // Bug metrics
      const bugMetrics = {
        total: bugs.length,
        open: bugs.filter(b => b.status === 'open').length,
        inProgress: bugs.filter(b => b.status === 'in-progress').length,
        resolved: bugs.filter(b => b.status === 'resolved').length,
        closed: bugs.filter(b => b.status === 'closed').length,
        bySeverity: {
          critical: bugs.filter(b => b.severity === 'critical').length,
          high: bugs.filter(b => b.severity === 'high').length,
          medium: bugs.filter(b => b.severity === 'medium').length,
          low: bugs.filter(b => b.severity === 'low').length,
        },
      };

      // Unassigned tasks
      const unassignedTasks = tasks.filter(t => !t.developer && t.status !== 'done').length;
      const noSprintTasks = tasks.filter(t => !t.sprintId && t.status !== 'done').length;

      return {
        project: { id: projectId, name: project.name, status: project.status },
        taskMetrics: { total, toDo, inProgress, toValidate, validated, done, completionPercentage },
        developerMetrics,
        sprintMetrics,
        bugMetrics,
        alerts: {
          unassignedTasks,
          noSprintTasks,
          criticalBugs: bugMetrics.bySeverity.critical,
        },
      };
    },
  },

  developer_workload: {
    description: 'Obtiene la carga de trabajo de cada desarrollador en un proyecto: tareas asignadas, puntos pendientes, tareas completadas.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      const tasks = (await getAll('tasks')).filter(t => t.projectId === projectId);
      const users = await getAll('users');
      const usersMap = Object.fromEntries(users.map(u => [u.id || u.uid, u]));

      const devMap = {};
      for (const task of tasks) {
        if (!task.developer) continue;
        if (!devMap[task.developer]) {
          const user = usersMap[task.developer];
          devMap[task.developer] = {
            userId: task.developer,
            displayName: user?.displayName || task.developer,
            email: user?.email || '',
            tasks: [],
            load: 0,
            completed: 0,
            inProgress: 0,
            pending: 0,
          };
        }

        const dm = devMap[task.developer];
        dm.tasks.push({ id: task.id, title: task.title, status: task.status, devPoints: task.devPoints, priority: task.priority });

        if (task.status === 'done') dm.completed++;
        else {
          dm.load += task.devPoints || 0;
          if (task.status === 'in-progress') dm.inProgress++;
          else dm.pending++;
        }
      }

      return Object.values(devMap).sort((a, b) => b.load - a.load);
    },
  },

  sprint_burndown: {
    description: 'Obtiene datos de burndown de un sprint: tareas/puntos totales vs completados, progreso por día.',
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

      const tasks = (await getAll('tasks')).filter(t => t.sprintId === sprintId);
      const totalPoints = tasks.reduce((sum, t) => sum + (t.devPoints || 0), 0);
      const completedPoints = tasks.filter(t => t.status === 'done').reduce((sum, t) => sum + (t.devPoints || 0), 0);
      const remainingPoints = totalPoints - completedPoints;

      // Days calculations
      const start = new Date(sprint.startDate);
      const end = new Date(sprint.endDate);
      const today = new Date();
      const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      const elapsedDays = Math.max(0, Math.ceil((Math.min(today, end) - start) / (1000 * 60 * 60 * 24)));
      const remainingDays = Math.max(0, Math.ceil((end - today) / (1000 * 60 * 60 * 24)));

      // Ideal burndown rate
      const idealDailyRate = totalDays > 0 ? totalPoints / totalDays : 0;
      const idealRemaining = Math.max(0, totalPoints - (idealDailyRate * elapsedDays));

      return {
        sprint: { id: sprintId, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, status: sprint.status },
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'done').length,
        totalPoints,
        completedPoints,
        remainingPoints,
        totalDays,
        elapsedDays,
        remainingDays,
        idealRemaining: Math.round(idealRemaining * 10) / 10,
        isOnTrack: remainingPoints <= idealRemaining,
        tasksByStatus: {
          'to-do': tasks.filter(t => t.status === 'to-do').length,
          'in-progress': tasks.filter(t => t.status === 'in-progress').length,
          'to-validate': tasks.filter(t => t.status === 'to-validate').length,
          'validated': tasks.filter(t => t.status === 'validated').length,
          'done': tasks.filter(t => t.status === 'done').length,
        },
      };
    },
  },

  search_tasks: {
    description: 'Búsqueda avanzada de tareas con múltiples filtros combinados.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar en título o user story' },
        projectId: { type: 'string', description: 'Filtrar por proyecto' },
        statuses: { type: 'array', items: { type: 'string' }, description: 'Filtrar por estados (array)' },
        developers: { type: 'array', items: { type: 'string' }, description: 'Filtrar por desarrolladores (array de UIDs)' },
        minPriority: { type: 'number', description: 'Prioridad mínima' },
        maxPriority: { type: 'number', description: 'Prioridad máxima' },
        minBizPoints: { type: 'number', description: 'Puntos de negocio mínimos' },
        maxDevPoints: { type: 'number', description: 'Puntos de desarrollo máximos' },
        hasNoDeveloper: { type: 'boolean', description: 'Solo tareas sin desarrollador asignado' },
        hasNoSprint: { type: 'boolean', description: 'Solo tareas sin sprint asignado' },
      },
    },
    handler: async ({ query, projectId, statuses, developers, minPriority, maxPriority, minBizPoints, maxDevPoints, hasNoDeveloper, hasNoSprint }) => {
      let tasks = await getAll('tasks');

      if (projectId) tasks = tasks.filter(t => t.projectId === projectId);

      if (query) {
        const lower = query.toLowerCase();
        tasks = tasks.filter(t =>
          (t.title && t.title.toLowerCase().includes(lower)) ||
          (t.userStory?.who && t.userStory.who.toLowerCase().includes(lower)) ||
          (t.userStory?.what && t.userStory.what.toLowerCase().includes(lower)) ||
          (t.userStory?.why && t.userStory.why.toLowerCase().includes(lower))
        );
      }

      if (statuses && statuses.length > 0) tasks = tasks.filter(t => statuses.includes(t.status));
      if (developers && developers.length > 0) tasks = tasks.filter(t => developers.includes(t.developer));
      if (minPriority !== undefined) tasks = tasks.filter(t => (t.priority || 0) >= minPriority);
      if (maxPriority !== undefined) tasks = tasks.filter(t => (t.priority || 0) <= maxPriority);
      if (minBizPoints !== undefined) tasks = tasks.filter(t => (t.bizPoints || 0) >= minBizPoints);
      if (maxDevPoints !== undefined) tasks = tasks.filter(t => (t.devPoints || 0) <= maxDevPoints);
      if (hasNoDeveloper) tasks = tasks.filter(t => !t.developer);
      if (hasNoSprint) tasks = tasks.filter(t => !t.sprintId);

      return tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    },
  },

  project_summary: {
    description: 'Genera un resumen ejecutivo de un proyecto en lenguaje natural, incluyendo estado general, riesgos y próximos pasos sugeridos.',
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

      const [allTasks, allSprints, allBugs, allProposals] = await Promise.all([
        getAll('tasks'),
        getAll('sprints'),
        getAll('bugs'),
        getAll('proposals'),
      ]);

      const tasks = allTasks.filter(t => t.projectId === projectId);
      const sprints = allSprints.filter(s => s.projectId === projectId);
      const bugs = allBugs.filter(b => b.projectId === projectId);
      const proposals = allProposals.filter(p => p.projectId === projectId);

      const total = tasks.length;
      const done = tasks.filter(t => t.status === 'done').length;
      const activeSprint = sprints.find(s => s.status === 'active');
      const criticalBugs = bugs.filter(b => b.severity === 'critical' && b.status !== 'closed').length;
      const pendingProposals = proposals.filter(p => p.status === 'pending').length;
      const unassigned = tasks.filter(t => !t.developer && t.status !== 'done').length;
      const noSprint = tasks.filter(t => !t.sprintId && t.status !== 'done').length;
      const totalDevPoints = tasks.reduce((sum, t) => sum + (t.devPoints || 0), 0);
      const completedDevPoints = tasks.filter(t => t.status === 'done').reduce((sum, t) => sum + (t.devPoints || 0), 0);

      // Developer workloads
      const devLoads = {};
      for (const task of tasks) {
        if (task.developer && task.status !== 'done') {
          devLoads[task.developer] = (devLoads[task.developer] || 0) + (task.devPoints || 0);
        }
      }
      const maxLoad = Math.max(...Object.values(devLoads), 0);
      const overloadedDevs = Object.entries(devLoads).filter(([, load]) => load > 20);

      const risks = [];
      if (criticalBugs > 0) risks.push(`${criticalBugs} bug(s) crítico(s) sin resolver`);
      if (unassigned > 3) risks.push(`${unassigned} tareas sin asignar`);
      if (noSprint > 5) risks.push(`${noSprint} tareas sin sprint`);
      if (overloadedDevs.length > 0) risks.push(`${overloadedDevs.length} desarrollador(es) sobrecargado(s)`);
      if (activeSprint) {
        const daysLeft = Math.ceil((new Date(activeSprint.endDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 3 && daysLeft >= 0) risks.push(`Sprint activo "${activeSprint.name}" termina en ${daysLeft} días`);
      }

      return {
        project: { name: project.name, status: project.status, startDate: project.startDate, endDate: project.endDate },
        overview: {
          totalTasks: total,
          completedTasks: done,
          completionPercentage: total > 0 ? Math.round((done / total) * 100) : 0,
          totalDevPoints,
          completedDevPoints,
          velocityPercentage: totalDevPoints > 0 ? Math.round((completedDevPoints / totalDevPoints) * 100) : 0,
          totalSprints: sprints.length,
          activeSprint: activeSprint ? { name: activeSprint.name, endDate: activeSprint.endDate } : null,
          totalBugs: bugs.length,
          criticalBugs,
          pendingProposals,
          unassignedTasks: unassigned,
          noSprintTasks: noSprint,
        },
        risks,
        memberCount: project.members ? Object.keys(project.members).length : 0,
      };
    },
  },
};
