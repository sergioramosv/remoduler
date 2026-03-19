import { getDb, getById } from '../firebase.js';
import { config } from '../config.js';

export const commentTools = {
  list_comments: {
    description: 'Lista todos los comentarios de una tarea, ordenados por fecha (más reciente primero).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const snapshot = await getDb().ref(`comments/${taskId}`).once('value');
      const data = snapshot.val();
      if (!data) return [];
      return Object.entries(data)
        .map(([id, val]) => ({ id, ...val }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  create_comment: {
    description: 'Añade un comentario a una tarea. Soporta @menciones a otros usuarios.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        text: { type: 'string', description: 'Texto del comentario. Usa @userId para mencionar usuarios.' },
        mentions: { type: 'array', items: { type: 'string' }, description: 'Lista de UIDs mencionados en el comentario' },
        userId: { type: 'string', description: 'UID del autor' },
        userName: { type: 'string', description: 'Nombre del autor' },
        userPhotoURL: { type: 'string', description: 'URL de avatar del autor (opcional)' },
      },
      required: ['taskId', 'text'],
    },
    handler: async ({ taskId, text, mentions, userId, userName, userPhotoURL }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;

      const task = await getById('tasks', taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const now = Date.now();
      const ref = getDb().ref(`comments/${taskId}`).push();
      const commentData = {
        id: ref.key,
        taskId,
        userId: uid || '',
        userName: uname || '',
        userPhotoURL: userPhotoURL || '',
        text,
        mentions: mentions || [],
        createdAt: now,
        updatedAt: now,
        edited: false,
      };

      await ref.set(commentData);

      // Notify mentioned users
      if (mentions && mentions.length > 0) {
        for (const mentionedId of mentions) {
          if (mentionedId === uid) continue;
          try {
            const notifRef = getDb().ref(`notifications/${mentionedId}`).push();
            await notifRef.set({
              id: notifRef.key,
              userId: mentionedId,
              title: 'Mención en comentario',
              message: `${uname || 'Alguien'} te mencionó en la tarea "${task.title}"`,
              type: 'info',
              read: false,
              date: now,
              link: `/projects/${task.projectId}`,
            });
          } catch { /* */ }
        }
      }

      // Notify task developer
      if (task.developer && task.developer !== uid) {
        try {
          const notifRef = getDb().ref(`notifications/${task.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: task.developer,
            title: 'Nuevo comentario',
            message: `${uname || 'Alguien'} comentó en la tarea "${task.title}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${task.projectId}`,
          });
        } catch { /* */ }
      }

      return { id: ref.key, message: `Comentario añadido a "${task.title}"` };
    },
  },

  update_comment: {
    description: 'Edita un comentario existente.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        commentId: { type: 'string', description: 'ID del comentario' },
        text: { type: 'string', description: 'Nuevo texto' },
        mentions: { type: 'array', items: { type: 'string' }, description: 'Nueva lista de menciones' },
      },
      required: ['taskId', 'commentId', 'text'],
    },
    handler: async ({ taskId, commentId, text, mentions }) => {
      const updates = { text, updatedAt: Date.now(), edited: true };
      if (mentions) updates.mentions = mentions;
      await getDb().ref(`comments/${taskId}/${commentId}`).update(updates);
      return { message: 'Comentario actualizado' };
    },
  },

  delete_comment: {
    description: 'Elimina un comentario de una tarea.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        commentId: { type: 'string', description: 'ID del comentario' },
      },
      required: ['taskId', 'commentId'],
    },
    handler: async ({ taskId, commentId }) => {
      await getDb().ref(`comments/${taskId}/${commentId}`).remove();
      return { message: 'Comentario eliminado' };
    },
  },
};
