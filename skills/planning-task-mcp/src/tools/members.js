import { getAll, getById, update, getDb } from '../firebase.js';
import { config } from '../config.js';

export const memberTools = {
  list_members: {
    description: 'Lista todos los miembros de un proyecto con sus roles y datos de usuario.',
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
      if (!project.members) return [];

      const users = await getAll('users');
      const usersMap = Object.fromEntries(users.map(u => [u.id || u.uid, u]));

      const members = [];
      for (const [uid, memberData] of Object.entries(project.members)) {
        const user = usersMap[uid];
        if (typeof memberData === 'object') {
          members.push({
            userId: uid,
            role: memberData.role || 'member',
            addedAt: memberData.addedAt,
            addedBy: memberData.addedBy,
            displayName: user?.displayName || '',
            email: user?.email || '',
          });
        } else {
          // Legacy format (boolean)
          members.push({
            userId: uid,
            role: project.createdBy === uid ? 'owner' : 'member',
            displayName: user?.displayName || '',
            email: user?.email || '',
          });
        }
      }

      return members;
    },
  },

  add_member: {
    description: 'Añade un miembro a un proyecto con un rol específico.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        userId: { type: 'string', description: 'UID del usuario a añadir' },
        role: { type: 'string', enum: ['admin', 'member', 'viewer'], description: 'Rol del nuevo miembro. Default: member' },
        addedBy: { type: 'string', description: 'UID del usuario que añade. Si no se pasa, usa el default.' },
      },
      required: ['projectId', 'userId'],
    },
    handler: async ({ projectId, userId, role, addedBy }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      if (project.members && project.members[userId]) {
        return { error: `El usuario ${userId} ya es miembro del proyecto` };
      }

      const by = addedBy || config.defaultUserId;
      const now = Date.now();

      await getDb().ref(`projects/${projectId}/members/${userId}`).set({
        userId,
        role: role || 'member',
        addedAt: now,
        addedBy: by || '',
      });

      // Send notification
      try {
        const notifRef = getDb().ref(`notifications/${userId}`).push();
        await notifRef.set({
          id: notifRef.key,
          userId,
          title: 'Añadido a proyecto',
          message: `Has sido añadido al proyecto "${project.name}" como ${role || 'member'}`,
          type: 'success',
          read: false,
          date: now,
          link: `/projects/${projectId}`,
        });
      } catch { /* */ }

      return { message: `Usuario ${userId} añadido como ${role || 'member'} al proyecto "${project.name}"` };
    },
  },

  remove_member: {
    description: 'Elimina un miembro de un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        userId: { type: 'string', description: 'UID del usuario a eliminar' },
      },
      required: ['projectId', 'userId'],
    },
    handler: async ({ projectId, userId }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      if (!project.members || !project.members[userId]) {
        return { error: `El usuario ${userId} no es miembro del proyecto` };
      }

      const memberData = project.members[userId];
      const memberRole = typeof memberData === 'object' ? memberData.role : 'member';

      if (memberRole === 'owner') {
        return { error: 'No se puede eliminar al owner del proyecto' };
      }

      await getDb().ref(`projects/${projectId}/members/${userId}`).remove();

      // Send notification
      try {
        const notifRef = getDb().ref(`notifications/${userId}`).push();
        await notifRef.set({
          id: notifRef.key,
          userId,
          title: 'Eliminado de proyecto',
          message: `Has sido eliminado del proyecto "${project.name}"`,
          type: 'warning',
          read: false,
          date: Date.now(),
        });
      } catch { /* */ }

      return { message: `Usuario ${userId} eliminado del proyecto "${project.name}"` };
    },
  },

  change_member_role: {
    description: 'Cambia el rol de un miembro dentro de un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        userId: { type: 'string', description: 'UID del miembro' },
        newRole: { type: 'string', enum: ['admin', 'member', 'viewer'], description: 'Nuevo rol' },
      },
      required: ['projectId', 'userId', 'newRole'],
    },
    handler: async ({ projectId, userId, newRole }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      if (!project.members || !project.members[userId]) {
        return { error: `El usuario ${userId} no es miembro del proyecto` };
      }

      const memberData = project.members[userId];
      const currentRole = typeof memberData === 'object' ? memberData.role : 'member';
      if (currentRole === 'owner') return { error: 'No se puede cambiar el rol del owner' };

      await getDb().ref(`projects/${projectId}/members/${userId}/role`).set(newRole);
      return { message: `Rol de ${userId} cambiado de "${currentRole}" a "${newRole}" en "${project.name}"` };
    },
  },
};
