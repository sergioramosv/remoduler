import { getAll, getById, create, remove } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'saved-views';

export const savedViewTools = {
  list_saved_views: {
    description: 'Lista las vistas guardadas de un proyecto (propias del usuario + compartidas).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        userId: { type: 'string', description: 'UID del usuario. Si no se pasa, usa DEFAULT_USER_ID.' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, userId }) => {
      const uid = userId || config.defaultUserId;
      let views = await getAll(PATH);
      views = views.filter(v => v.projectId === projectId && (v.userId === uid || v.shared === true));
      return views.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  create_saved_view: {
    description: 'Crea una vista guardada con una combinación de filtros de tareas.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        name: { type: 'string', description: 'Nombre de la vista' },
        filters: {
          type: 'object',
          description: 'Configuración de filtros',
          properties: {
            searchText: { type: 'string', description: 'Texto de búsqueda' },
            selectedDeveloper: { type: 'string', description: 'UID del developer filtrado' },
            selectedStatus: { type: 'string', description: 'Estado filtrado' },
            selectedSprint: { type: 'string', description: 'Sprint ID filtrado' },
            selectedEpic: { type: 'string', description: 'Epic ID filtrado' },
          },
        },
        shared: { type: 'boolean', description: 'Si la vista es compartida con el equipo. Default: false' },
        userId: { type: 'string', description: 'UID del creador' },
      },
      required: ['projectId', 'name', 'filters'],
    },
    handler: async ({ projectId, name, filters, shared, userId }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const uid = userId || config.defaultUserId;
      const now = Date.now();
      const viewData = {
        projectId,
        name,
        userId: uid || '',
        filters: filters || {},
        shared: shared || false,
        createdAt: now,
        updatedAt: now,
      };

      const id = await create(PATH, viewData);
      return { id, message: `Vista "${name}" guardada`, view: { id, ...viewData } };
    },
  },

  delete_saved_view: {
    description: 'Elimina una vista guardada.',
    inputSchema: {
      type: 'object',
      properties: {
        viewId: { type: 'string', description: 'ID de la vista a eliminar' },
      },
      required: ['viewId'],
    },
    handler: async ({ viewId }) => {
      const view = await getById(PATH, viewId);
      if (!view) return { error: `Vista ${viewId} no encontrada` };
      await remove(PATH, viewId);
      return { message: `Vista "${view.name}" eliminada` };
    },
  },
};
