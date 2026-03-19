import { getDb } from '../firebase.js';
import { config } from '../config.js';

export const notificationTools = {
  list_notifications: {
    description: 'Lista las notificaciones de un usuario, ordenadas por fecha (más recientes primero).',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario. Si no se pasa, usa el default.' },
        unreadOnly: { type: 'boolean', description: 'Si true, solo devuelve las no leídas. Default: false' },
      },
    },
    handler: async ({ userId, unreadOnly }) => {
      const uid = userId || config.defaultUserId;
      if (!uid) return { error: 'Se requiere userId o DEFAULT_USER_ID' };

      const snapshot = await getDb().ref(`notifications/${uid}`).once('value');
      const data = snapshot.val();
      if (!data) return [];

      let notifications = Object.entries(data)
        .map(([id, val]) => ({ id, ...val }))
        .sort((a, b) => (b.date || 0) - (a.date || 0));

      if (unreadOnly) notifications = notifications.filter(n => !n.read);
      return notifications;
    },
  },

  mark_notification_read: {
    description: 'Marca una notificación como leída.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario' },
        notificationId: { type: 'string', description: 'ID de la notificación' },
      },
      required: ['notificationId'],
    },
    handler: async ({ userId, notificationId }) => {
      const uid = userId || config.defaultUserId;
      await getDb().ref(`notifications/${uid}/${notificationId}`).update({ read: true });
      return { message: 'Notificación marcada como leída' };
    },
  },

  mark_all_notifications_read: {
    description: 'Marca todas las notificaciones de un usuario como leídas.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario' },
      },
    },
    handler: async ({ userId }) => {
      const uid = userId || config.defaultUserId;
      if (!uid) return { error: 'Se requiere userId o DEFAULT_USER_ID' };

      const snapshot = await getDb().ref(`notifications/${uid}`).once('value');
      const data = snapshot.val();
      if (!data) return { message: 'No hay notificaciones' };

      const updates = {};
      for (const [id, notif] of Object.entries(data)) {
        if (!notif.read) updates[`${id}/read`] = true;
      }

      if (Object.keys(updates).length === 0) return { message: 'Todas ya estaban leídas' };
      await getDb().ref(`notifications/${uid}`).update(updates);
      return { message: `${Object.keys(updates).length} notificaciones marcadas como leídas` };
    },
  },

  clear_notifications: {
    description: 'Elimina todas las notificaciones de un usuario.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario' },
      },
    },
    handler: async ({ userId }) => {
      const uid = userId || config.defaultUserId;
      if (!uid) return { error: 'Se requiere userId o DEFAULT_USER_ID' };
      await getDb().ref(`notifications/${uid}`).remove();
      return { message: 'Todas las notificaciones eliminadas' };
    },
  },

  send_notification: {
    description: 'Envía una notificación personalizada a un usuario.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del destinatario' },
        title: { type: 'string', description: 'Título de la notificación' },
        message: { type: 'string', description: 'Mensaje' },
        type: { type: 'string', enum: ['info', 'success', 'warning', 'error'], description: 'Tipo. Default: info' },
        link: { type: 'string', description: 'Enlace de navegación (opcional)' },
      },
      required: ['userId', 'title', 'message'],
    },
    handler: async ({ userId, title, message, type, link }) => {
      const ref = getDb().ref(`notifications/${userId}`).push();
      await ref.set({
        id: ref.key,
        userId,
        title,
        message,
        type: type || 'info',
        read: false,
        date: Date.now(),
        link: link || '',
      });
      return { id: ref.key, message: `Notificación enviada a ${userId}` };
    },
  },
};
