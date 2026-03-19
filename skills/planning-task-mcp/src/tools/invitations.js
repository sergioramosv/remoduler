import { getAll, getById, create, update, getDb } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'invitations';

export const invitationTools = {
  list_invitations: {
    description: 'Lista invitaciones. Puede filtrar por usuario invitado, proyecto, o estado.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario invitado para ver sus invitaciones pendientes' },
        projectId: { type: 'string', description: 'ID del proyecto para ver invitaciones enviadas' },
        status: { type: 'string', enum: ['pending', 'accepted', 'rejected'], description: 'Filtrar por estado' },
      },
    },
    handler: async ({ userId, projectId, status }) => {
      let invitations = await getAll(PATH);
      if (userId) invitations = invitations.filter(i => i.invitedUserId === userId);
      if (projectId) invitations = invitations.filter(i => i.projectId === projectId);
      if (status) invitations = invitations.filter(i => i.status === status);
      return invitations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  send_invitation: {
    description: 'Envía una invitación para unirse a un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        invitedUserId: { type: 'string', description: 'UID del usuario a invitar' },
        invitedUserEmail: { type: 'string', description: 'Email del usuario a invitar' },
        senderId: { type: 'string', description: 'UID del que envía la invitación' },
        senderName: { type: 'string', description: 'Nombre del que envía' },
      },
      required: ['projectId', 'invitedUserId', 'invitedUserEmail'],
    },
    handler: async ({ projectId, invitedUserId, invitedUserEmail, senderId, senderName }) => {
      const uid = senderId || config.defaultUserId;
      const uname = senderName || config.defaultUserName;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      // Check if already a member
      if (project.members && project.members[invitedUserId]) {
        return { error: 'El usuario ya es miembro del proyecto' };
      }

      // Check for existing pending invitation
      const existing = await getAll(PATH);
      const pending = existing.find(i =>
        i.projectId === projectId &&
        i.invitedUserId === invitedUserId &&
        i.status === 'pending'
      );
      if (pending) return { error: 'Ya existe una invitación pendiente para este usuario' };

      const invitationData = {
        projectId,
        projectName: project.name,
        projectCreatorId: uid || '',
        projectCreatorName: uname || '',
        invitedUserId,
        invitedUserEmail,
        status: 'pending',
        createdAt: Date.now(),
      };

      const id = await create(PATH, invitationData);

      // Notify invited user
      try {
        const notifRef = getDb().ref(`notifications/${invitedUserId}`).push();
        await notifRef.set({
          id: notifRef.key,
          userId: invitedUserId,
          title: 'Invitación a proyecto',
          message: `${uname || 'Alguien'} te ha invitado al proyecto "${project.name}"`,
          type: 'info',
          read: false,
          date: Date.now(),
        });
      } catch { /* */ }

      return { id, message: `Invitación enviada a ${invitedUserEmail} para "${project.name}"` };
    },
  },

  accept_invitation: {
    description: 'Acepta una invitación y añade al usuario como miembro del proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        invitationId: { type: 'string', description: 'ID de la invitación' },
      },
      required: ['invitationId'],
    },
    handler: async ({ invitationId }) => {
      const invitation = await getById(PATH, invitationId);
      if (!invitation) return { error: `Invitación ${invitationId} no encontrada` };
      if (invitation.status !== 'pending') return { error: `La invitación ya fue ${invitation.status}` };

      const now = Date.now();

      // Update invitation status
      await update(PATH, invitationId, { status: 'accepted', respondedAt: now });

      // Add as member
      await getDb().ref(`projects/${invitation.projectId}/members/${invitation.invitedUserId}`).set({
        userId: invitation.invitedUserId,
        role: 'member',
        addedAt: now,
        addedBy: invitation.projectCreatorId || '',
      });

      return { message: `Invitación aceptada. Usuario añadido a "${invitation.projectName}"` };
    },
  },

  reject_invitation: {
    description: 'Rechaza una invitación a un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        invitationId: { type: 'string', description: 'ID de la invitación' },
      },
      required: ['invitationId'],
    },
    handler: async ({ invitationId }) => {
      const invitation = await getById(PATH, invitationId);
      if (!invitation) return { error: `Invitación ${invitationId} no encontrada` };
      if (invitation.status !== 'pending') return { error: `La invitación ya fue ${invitation.status}` };

      await update(PATH, invitationId, { status: 'rejected', respondedAt: Date.now() });
      return { message: `Invitación a "${invitation.projectName}" rechazada` };
    },
  },
};
