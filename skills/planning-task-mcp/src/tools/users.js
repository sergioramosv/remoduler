import { getAll, getById } from '../firebase.js';

export const userTools = {
  list_users: {
    description: 'Lista todos los usuarios registrados en el sistema.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const users = await getAll('users');
      return users.map(u => ({
        uid: u.id || u.uid,
        email: u.email || '',
        displayName: u.displayName || '',
        role: u.role || 'developer',
        photoURL: u.photoURL || '',
      }));
    },
  },

  get_user: {
    description: 'Obtiene los datos de un usuario por su UID.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario' },
      },
      required: ['userId'],
    },
    handler: async ({ userId }) => {
      const user = await getById('users', userId);
      if (!user) return { error: `Usuario ${userId} no encontrado` };
      return {
        uid: user.id || user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        role: user.role || 'developer',
        photoURL: user.photoURL || '',
      };
    },
  },

  search_users: {
    description: 'Busca usuarios por nombre o email.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar en nombre o email' },
      },
      required: ['query'],
    },
    handler: async ({ query }) => {
      const users = await getAll('users');
      const lower = query.toLowerCase();
      return users
        .filter(u =>
          (u.displayName && u.displayName.toLowerCase().includes(lower)) ||
          (u.email && u.email.toLowerCase().includes(lower))
        )
        .map(u => ({
          uid: u.id || u.uid,
          email: u.email || '',
          displayName: u.displayName || '',
          role: u.role || 'developer',
        }));
    },
  },
};
