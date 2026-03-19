import { getAll, getById, create, update, remove } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'bugs';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const BUG_STATUSES = ['open', 'in-progress', 'resolved', 'closed'];

export const bugTools = {
  list_bugs: {
    description: 'Lista bugs de un proyecto. Opcionalmente filtra por estado o severidad.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        status: { type: 'string', enum: BUG_STATUSES, description: 'Filtrar por estado' },
        severity: { type: 'string', enum: SEVERITIES, description: 'Filtrar por severidad' },
        assignedTo: { type: 'string', description: 'Filtrar por desarrollador asignado (UID)' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, status, severity, assignedTo }) => {
      let bugs = await getAll(PATH);
      bugs = bugs.filter(b => b.projectId === projectId);
      if (status) bugs = bugs.filter(b => b.status === status);
      if (severity) bugs = bugs.filter(b => b.severity === severity);
      if (assignedTo) bugs = bugs.filter(b => b.assignedTo === assignedTo);
      return bugs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  get_bug: {
    description: 'Obtiene el detalle completo de un bug por su ID.',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'string', description: 'ID del bug' },
      },
      required: ['bugId'],
    },
    handler: async ({ bugId }) => {
      const bug = await getById(PATH, bugId);
      if (!bug) return { error: `Bug ${bugId} no encontrado` };
      return bug;
    },
  },

  create_bug: {
    description: 'Crea un nuevo reporte de bug en un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        title: { type: 'string', description: 'Título del bug' },
        description: { type: 'string', description: 'Descripción detallada del bug' },
        severity: { type: 'string', enum: SEVERITIES, description: 'Severidad: critical, high, medium, low' },
        assignedTo: { type: 'string', description: 'UID del desarrollador asignado (opcional)' },
        status: { type: 'string', enum: BUG_STATUSES, description: 'Estado inicial. Default: open' },
        attachments: {
          type: 'array',
          description: 'Archivos adjuntos del bug (opcional). Capturas de pantalla, logs, etc.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID único del adjunto' },
              name: { type: 'string', description: 'Nombre del archivo' },
              url: { type: 'string', description: 'URL pública de descarga' },
              uploadedAt: { type: 'number', description: 'Timestamp de subida' },
              uploadedBy: { type: 'string', description: 'UID del usuario que subió' },
            },
            required: ['id', 'name', 'url', 'uploadedAt', 'uploadedBy'],
          },
        },
        userId: { type: 'string', description: 'UID del creador' },
        userName: { type: 'string', description: 'Nombre del creador' },
      },
      required: ['projectId', 'title', 'description', 'severity'],
    },
    handler: async ({ projectId, title, description, severity, assignedTo, status, attachments, userId, userName }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const now = Date.now();
      const bugData = {
        title,
        description,
        projectId,
        severity,
        status: status || 'open',
        assignedTo: assignedTo || '',
        attachments: attachments || [],
        createdAt: now,
        updatedAt: now,
        createdBy: uid || '',
        createdByName: uname || '',
      };

      const id = await create(PATH, bugData);
      return { id, message: `Bug "${title}" (${severity}) creado en "${project.name}"`, bug: { id, ...bugData } };
    },
  },

  update_bug: {
    description: 'Actualiza un bug existente (título, descripción, severidad, estado, asignación, adjuntos).',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'string', description: 'ID del bug' },
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: SEVERITIES },
        status: { type: 'string', enum: BUG_STATUSES },
        assignedTo: { type: 'string', description: 'UID del desarrollador (vacío para desasignar)' },
        attachments: {
          type: 'array',
          description: 'Archivos adjuntos (reemplaza los existentes)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              url: { type: 'string' },
              uploadedAt: { type: 'number' },
              uploadedBy: { type: 'string' },
            },
          },
        },
      },
      required: ['bugId'],
    },
    handler: async ({ bugId, ...updates }) => {
      const bug = await getById(PATH, bugId);
      if (!bug) return { error: `Bug ${bugId} no encontrado` };

      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { error: 'No se proporcionaron campos para actualizar' };

      clean.updatedAt = Date.now();
      await update(PATH, bugId, clean);
      return { message: `Bug "${bug.title}" actualizado`, updated: clean };
    },
  },

  delete_bug: {
    description: 'Elimina un bug.',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'string', description: 'ID del bug a eliminar' },
      },
      required: ['bugId'],
    },
    handler: async ({ bugId }) => {
      const bug = await getById(PATH, bugId);
      if (!bug) return { error: `Bug ${bugId} no encontrado` };
      await remove(PATH, bugId);
      return { message: `Bug "${bug.title}" eliminado` };
    },
  },
};
