import { getAll, getById, create, remove } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'task-templates';

export const taskTemplateTools = {
  list_task_templates: {
    description: 'Lista las plantillas de tareas de un proyecto. Las plantillas permiten crear tareas rápidamente con datos predefinidos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      let templates = await getAll(PATH);
      templates = templates.filter(t => t.projectId === projectId);
      return templates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  create_task_template: {
    description: 'Crea una plantilla de tarea reutilizable con User Story, criterios y puntos predefinidos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        name: { type: 'string', description: 'Nombre de la plantilla' },
        titlePattern: { type: 'string', description: 'Patrón de título para tareas creadas con esta plantilla' },
        userStory: {
          type: 'object',
          description: 'User Story predefinida',
          properties: {
            who: { type: 'string', description: 'Como... (actor)' },
            what: { type: 'string', description: 'Quiero... (funcionalidad)' },
            why: { type: 'string', description: 'Para... (beneficio)' },
          },
          required: ['who', 'what', 'why'],
        },
        acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Criterios de aceptación predefinidos' },
        bizPoints: { type: 'number', description: 'Puntos de negocio (Fibonacci: 1,2,3,5,8,13,21,34)' },
        devPoints: { type: 'number', description: 'Puntos de desarrollo (Fibonacci: 1,2,3,5,8,13)' },
        userId: { type: 'string', description: 'UID del creador' },
      },
      required: ['projectId', 'name', 'titlePattern', 'userStory', 'acceptanceCriteria', 'bizPoints', 'devPoints'],
    },
    handler: async ({ projectId, name, titlePattern, userStory, acceptanceCriteria, bizPoints, devPoints, userId }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const uid = userId || config.defaultUserId;
      const templateData = {
        projectId,
        name,
        titlePattern,
        userStory,
        acceptanceCriteria,
        bizPoints,
        devPoints,
        createdAt: Date.now(),
        createdBy: uid || '',
      };

      const id = await create(PATH, templateData);
      return { id, message: `Plantilla "${name}" creada`, template: { id, ...templateData } };
    },
  },

  delete_task_template: {
    description: 'Elimina una plantilla de tarea.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'ID de la plantilla a eliminar' },
      },
      required: ['templateId'],
    },
    handler: async ({ templateId }) => {
      const template = await getById(PATH, templateId);
      if (!template) return { error: `Plantilla ${templateId} no encontrada` };
      await remove(PATH, templateId);
      return { message: `Plantilla "${template.name}" eliminada` };
    },
  },
};
