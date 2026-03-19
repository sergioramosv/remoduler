import { getAll, getById, create, update, remove } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'proposals';
const FIBONACCI = [1, 2, 3, 5, 8, 13];
const BIZ_FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34];

export const proposalTools = {
  list_proposals: {
    description: 'Lista propuestas de un proyecto. Opcionalmente filtra por estado (pending, accepted, rejected).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        status: { type: 'string', enum: ['pending', 'accepted', 'rejected'], description: 'Filtrar por estado' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, status }) => {
      let proposals = await getAll(PATH);
      proposals = proposals.filter(p => p.projectId === projectId);
      if (status) proposals = proposals.filter(p => p.status === status);
      return proposals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  create_proposal: {
    description: 'Crea una propuesta de tarea para que sea revisada y aprobada por un owner/admin.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        title: { type: 'string', description: 'Título de la propuesta' },
        userStory: {
          type: 'object',
          properties: {
            who: { type: 'string', description: 'Como... (quién)' },
            what: { type: 'string', description: 'Quiero... (qué)' },
            why: { type: 'string', description: 'Para... (beneficio)' },
          },
          required: ['who', 'what', 'why'],
        },
        acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Criterios de aceptación' },
        bizPoints: { type: 'number', enum: BIZ_FIBONACCI, description: 'Puntos de negocio (Fibonacci: 1,2,3,5,8,13,21,34)' },
        devPoints: { type: 'number', enum: FIBONACCI, description: 'Puntos de desarrollo (Fibonacci)' },
        startDate: { type: 'string', description: 'Fecha estimada de inicio (YYYY-MM-DD)' },
        userId: { type: 'string' },
        userName: { type: 'string' },
      },
      required: ['projectId', 'title', 'userStory', 'acceptanceCriteria', 'bizPoints', 'devPoints'],
    },
    handler: async ({ projectId, title, userStory, acceptanceCriteria, bizPoints, devPoints, startDate, userId, userName }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const now = Date.now();
      const proposalData = {
        title,
        projectId,
        userStory,
        acceptanceCriteria: acceptanceCriteria.filter(c => c.trim().length > 0),
        bizPoints,
        devPoints,
        startDate: startDate || '',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        createdBy: uid || '',
        createdByName: uname || '',
      };

      const id = await create(PATH, proposalData);
      return { id, message: `Propuesta "${title}" creada en "${project.name}"`, proposal: { id, ...proposalData } };
    },
  },

  update_proposal: {
    description: 'Actualiza campos de una propuesta existente (título, userStory, criterios, puntos, fecha).',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'ID de la propuesta' },
        title: { type: 'string', description: 'Nuevo título' },
        userStory: {
          type: 'object',
          properties: {
            who: { type: 'string' },
            what: { type: 'string' },
            why: { type: 'string' },
          },
        },
        acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Nuevos criterios de aceptación' },
        bizPoints: { type: 'number', description: 'Nuevos puntos de negocio (Fibonacci)' },
        devPoints: { type: 'number', description: 'Nuevos puntos de desarrollo (Fibonacci)' },
        startDate: { type: 'string', description: 'Nueva fecha estimada de inicio (YYYY-MM-DD)' },
      },
      required: ['proposalId'],
    },
    handler: async ({ proposalId, ...updates }) => {
      const proposal = await getById(PATH, proposalId);
      if (!proposal) return { error: `Propuesta ${proposalId} no encontrada` };
      if (proposal.status !== 'pending') return { error: `Solo se pueden editar propuestas pendientes. Estado actual: ${proposal.status}` };

      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { error: 'No se proporcionaron campos para actualizar' };

      if (clean.acceptanceCriteria) {
        clean.acceptanceCriteria = clean.acceptanceCriteria.filter(c => c.trim().length > 0);
      }

      clean.updatedAt = Date.now();
      await update(PATH, proposalId, clean);
      return { message: `Propuesta "${proposal.title}" actualizada`, updated: clean };
    },
  },

  update_proposal_status: {
    description: 'Aprueba o rechaza una propuesta. Solo owners y admins pueden hacerlo.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'ID de la propuesta' },
        status: { type: 'string', enum: ['accepted', 'rejected'], description: 'Nuevo estado: accepted o rejected' },
      },
      required: ['proposalId', 'status'],
    },
    handler: async ({ proposalId, status }) => {
      const proposal = await getById(PATH, proposalId);
      if (!proposal) return { error: `Propuesta ${proposalId} no encontrada` };
      if (proposal.status !== 'pending') return { error: `La propuesta ya fue ${proposal.status}` };

      await update(PATH, proposalId, { status, updatedAt: Date.now() });
      return { message: `Propuesta "${proposal.title}" ${status === 'accepted' ? 'aprobada' : 'rechazada'}` };
    },
  },

  delete_proposal: {
    description: 'Elimina una propuesta.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'ID de la propuesta' },
      },
      required: ['proposalId'],
    },
    handler: async ({ proposalId }) => {
      const proposal = await getById(PATH, proposalId);
      if (!proposal) return { error: `Propuesta ${proposalId} no encontrada` };
      await remove(PATH, proposalId);
      return { message: `Propuesta "${proposal.title}" eliminada` };
    },
  },
};
