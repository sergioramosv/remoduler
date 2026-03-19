import { getAll, getById, create, update, remove } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'sprints';

export const sprintTools = {
  list_sprints: {
    description: 'Lista los sprints de un proyecto. Opcionalmente filtra por estado.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        status: { type: 'string', enum: ['planned', 'active', 'completed'], description: 'Filtrar por estado del sprint' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, status }) => {
      const sprints = await getAll(PATH);
      let filtered = sprints.filter(s => s.projectId === projectId);
      if (status) filtered = filtered.filter(s => s.status === status);
      return filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  get_sprint: {
    description: 'Obtiene el detalle de un sprint por su ID, incluyendo las tareas asignadas a él.',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string', description: 'ID del sprint' },
        includeTasks: { type: 'boolean', description: 'Si true, incluye las tareas del sprint. Default: false' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId, includeTasks }) => {
      const sprint = await getById(PATH, sprintId);
      if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };

      if (includeTasks) {
        const tasks = await getAll('tasks');
        sprint.tasks = tasks.filter(t => t.sprintId === sprintId)
          .sort((a, b) => (b.priority || 0) - (a.priority || 0));
        sprint.taskCount = sprint.tasks.length;
        sprint.completedTasks = sprint.tasks.filter(t => t.status === 'done').length;
      }

      return sprint;
    },
  },

  create_sprint: {
    description: 'Crea un nuevo sprint dentro de un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        name: { type: 'string', description: 'Nombre del sprint (3-100 caracteres)' },
        startDate: { type: 'string', description: 'Fecha de inicio (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'Fecha de fin (YYYY-MM-DD). Debe ser posterior a startDate' },
        status: { type: 'string', enum: ['planned', 'active', 'completed'], description: 'Estado inicial. Default: planned' },
        userId: { type: 'string', description: 'UID del creador. Si no se pasa, usa el default.' },
      },
      required: ['projectId', 'name', 'startDate', 'endDate'],
    },
    handler: async ({ projectId, name, startDate, endDate, status, userId }) => {
      const uid = userId || config.defaultUserId;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      if (new Date(endDate) <= new Date(startDate)) {
        return { error: 'La fecha de fin debe ser posterior a la fecha de inicio' };
      }

      const sprintData = {
        name,
        projectId,
        startDate,
        endDate,
        status: status || 'planned',
        createdAt: Date.now(),
        createdBy: uid || '',
      };

      const id = await create(PATH, sprintData);
      return { id, message: `Sprint "${name}" creado en proyecto "${project.name}"`, sprint: { id, ...sprintData } };
    },
  },

  update_sprint: {
    description: 'Actualiza un sprint existente (nombre, fechas, estado).',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string', description: 'ID del sprint' },
        name: { type: 'string', description: 'Nuevo nombre' },
        startDate: { type: 'string', description: 'Nueva fecha inicio (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'Nueva fecha fin (YYYY-MM-DD)' },
        status: { type: 'string', enum: ['planned', 'active', 'completed'], description: 'Nuevo estado' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId, ...updates }) => {
      const sprint = await getById(PATH, sprintId);
      if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };

      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { error: 'No se proporcionaron campos para actualizar' };

      await update(PATH, sprintId, clean);
      return { message: `Sprint "${sprint.name}" actualizado`, updated: clean };
    },
  },

  delete_sprint: {
    description: 'Elimina un sprint. Las tareas asignadas a él se desvinculan (sprintId se limpia).',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string', description: 'ID del sprint a eliminar' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId }) => {
      const sprint = await getById(PATH, sprintId);
      if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };

      // Unlink tasks from this sprint
      const tasks = await getAll('tasks');
      const sprintTasks = tasks.filter(t => t.sprintId === sprintId);
      for (const task of sprintTasks) {
        await update('tasks', task.id, { sprintId: '' });
      }

      await remove(PATH, sprintId);
      return { message: `Sprint "${sprint.name}" eliminado. ${sprintTasks.length} tareas desvinculadas.` };
    },
  },
};
