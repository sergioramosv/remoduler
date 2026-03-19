import { getAll, getById, create, update, remove } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'epics';

const EPIC_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#db2777', '#0891b2', '#4f46e5'];

export const epicTools = {
  list_epics: {
    description: 'Lista las epics de un proyecto. Las epics agrupan tareas por funcionalidad.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      let epics = await getAll(PATH);
      epics = epics.filter(e => e.projectId === projectId);
      epics = epics.map(e => ({ ...e, taskIds: e.taskIds || [] }));
      return epics.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  get_epic: {
    description: 'Obtiene el detalle de una epic por su ID, incluyendo progreso calculado de tareas.',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: { type: 'string', description: 'ID de la epic' },
      },
      required: ['epicId'],
    },
    handler: async ({ epicId }) => {
      const epic = await getById(PATH, epicId);
      if (!epic) return { error: `Epic ${epicId} no encontrada` };
      epic.taskIds = epic.taskIds || [];

      if (epic.taskIds.length > 0) {
        const allTasks = await getAll('tasks');
        const epicTasks = allTasks.filter(t => epic.taskIds.includes(t.id));
        const done = epicTasks.filter(t => t.status === 'done' || t.status === 'validated').length;
        epic.taskCount = epicTasks.length;
        epic.completedTasks = done;
        epic.progress = epicTasks.length > 0 ? Math.round((done / epicTasks.length) * 100) : 0;
        epic.tasks = epicTasks.map(t => ({ id: t.id, title: t.title, status: t.status, devPoints: t.devPoints, developer: t.developer }));
      } else {
        epic.taskCount = 0;
        epic.completedTasks = 0;
        epic.progress = 0;
        epic.tasks = [];
      }

      return epic;
    },
  },

  create_epic: {
    description: 'Crea una nueva epic en un proyecto para agrupar tareas por funcionalidad.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        title: { type: 'string', description: 'Título de la epic' },
        description: { type: 'string', description: 'Descripción de la epic (opcional)' },
        color: { type: 'string', description: 'Color hex de la epic (ej: #7c3aed). Default: #7c3aed' },
        startDate: { type: 'string', description: 'Fecha de inicio (YYYY-MM-DD, opcional)' },
        endDate: { type: 'string', description: 'Fecha de fin (YYYY-MM-DD, opcional)' },
        userId: { type: 'string', description: 'UID del creador' },
      },
      required: ['projectId', 'title'],
    },
    handler: async ({ projectId, title, description, color, startDate, endDate, userId }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const uid = userId || config.defaultUserId;
      const now = Date.now();
      const epicData = {
        projectId,
        title,
        description: description || '',
        color: color || '#7c3aed',
        taskIds: [],
        startDate: startDate || '',
        endDate: endDate || '',
        createdAt: now,
        updatedAt: now,
        createdBy: uid || '',
      };

      const id = await create(PATH, epicData);
      return { id, message: `Epic "${title}" creada en "${project.name}"`, epic: { id, ...epicData } };
    },
  },

  update_epic: {
    description: 'Actualiza campos de una epic existente (título, descripción, color, fechas).',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: { type: 'string', description: 'ID de la epic' },
        title: { type: 'string', description: 'Nuevo título' },
        description: { type: 'string', description: 'Nueva descripción' },
        color: { type: 'string', description: 'Nuevo color hex' },
        startDate: { type: 'string', description: 'Nueva fecha inicio (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'Nueva fecha fin (YYYY-MM-DD)' },
      },
      required: ['epicId'],
    },
    handler: async ({ epicId, title, description, color, startDate, endDate }) => {
      const epic = await getById(PATH, epicId);
      if (!epic) return { error: `Epic ${epicId} no encontrada` };

      const updates = Object.fromEntries(
        Object.entries({ title, description, color, startDate, endDate })
          .filter(([, v]) => v !== undefined)
      );
      updates.updatedAt = Date.now();

      await update(PATH, epicId, updates);
      return { message: `Epic "${epic.title}" actualizada` };
    },
  },

  delete_epic: {
    description: 'Elimina una epic. Las tareas vinculadas se desvinculan (epicId se limpia).',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: { type: 'string', description: 'ID de la epic a eliminar' },
      },
      required: ['epicId'],
    },
    handler: async ({ epicId }) => {
      const epic = await getById(PATH, epicId);
      if (!epic) return { error: `Epic ${epicId} no encontrada` };

      const taskIds = epic.taskIds || [];
      for (const taskId of taskIds) {
        try { await update('tasks', taskId, { epicId: '' }); } catch { /* task may not exist */ }
      }

      await remove(PATH, epicId);
      return { message: `Epic "${epic.title}" eliminada. ${taskIds.length} tareas desvinculadas.` };
    },
  },

  add_task_to_epic: {
    description: 'Añade una tarea a una epic. Actualiza tanto la epic como la tarea (bidireccional).',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: { type: 'string', description: 'ID de la epic' },
        taskId: { type: 'string', description: 'ID de la tarea a añadir' },
      },
      required: ['epicId', 'taskId'],
    },
    handler: async ({ epicId, taskId }) => {
      const epic = await getById(PATH, epicId);
      if (!epic) return { error: `Epic ${epicId} no encontrada` };
      const task = await getById('tasks', taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const taskIds = [...(epic.taskIds || [])];
      if (!taskIds.includes(taskId)) {
        taskIds.push(taskId);
        await update(PATH, epicId, { taskIds, updatedAt: Date.now() });
        await update('tasks', taskId, { epicId });
      }

      return { message: `Tarea "${task.title}" añadida a epic "${epic.title}"` };
    },
  },

  remove_task_from_epic: {
    description: 'Elimina una tarea de una epic. Actualiza tanto la epic como la tarea (bidireccional).',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: { type: 'string', description: 'ID de la epic' },
        taskId: { type: 'string', description: 'ID de la tarea a eliminar' },
      },
      required: ['epicId', 'taskId'],
    },
    handler: async ({ epicId, taskId }) => {
      const epic = await getById(PATH, epicId);
      if (!epic) return { error: `Epic ${epicId} no encontrada` };

      const taskIds = (epic.taskIds || []).filter(id => id !== taskId);
      await update(PATH, epicId, { taskIds, updatedAt: Date.now() });
      try { await update('tasks', taskId, { epicId: '' }); } catch { /* */ }

      return { message: `Tarea desvinculada de epic "${epic.title}"` };
    },
  },
};
