import { getAll, getById, create, update, remove, getDb } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'projects';

export const projectTools = {
  list_projects: {
    description: 'Lista los proyectos donde el usuario es miembro. Por defecto usa el UID configurado (DEFAULT_USER_ID). Para ver TODOS los proyectos, pasa allProjects=true.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'UID del usuario. Si no se pasa, usa DEFAULT_USER_ID del .env.' },
        allProjects: { type: 'boolean', description: 'Si true, devuelve todos los proyectos sin filtrar por miembro. Default: false.' },
      },
    },
    handler: async ({ userId, allProjects }) => {
      const projects = await getAll(PATH);
      if (allProjects) return projects;
      const uid = userId || config.defaultUserId;
      if (!uid) return projects; // fallback if no UID configured
      return projects.filter(p => p.members && (p.members[uid] === true || typeof p.members[uid] === 'object'));
    },
  },

  get_project: {
    description: 'Obtiene el detalle completo de un proyecto por su ID, incluyendo miembros y roles.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      const project = await getById(PATH, projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };
      return project;
    },
  },

  create_project: {
    description: 'Crea un nuevo proyecto. El usuario creador se añade automáticamente como owner.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre del proyecto (3-100 caracteres)' },
        description: { type: 'string', description: 'Descripción del proyecto (5-500 caracteres)' },
        startDate: { type: 'string', description: 'Fecha de inicio (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'Fecha de fin (YYYY-MM-DD)' },
        status: { type: 'string', enum: ['planned', 'active', 'completed', 'archived'], description: 'Estado del proyecto. Default: planned' },
        repositories: {
          type: 'array',
          description: 'Repositorios GitHub del proyecto',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL del repositorio (ej: https://github.com/user/repo)' },
              type: { type: 'string', enum: ['front', 'back', 'api', 'fullstack'], description: 'Tipo de repositorio' },
              isDefault: { type: 'boolean', description: 'Si es el repositorio por defecto del proyecto' },
            },
            required: ['url', 'type'],
          },
        },
        languages: { type: 'string', description: 'Lenguajes de programación separados por coma (ej: "TypeScript, Python, Go")' },
        frameworks: { type: 'string', description: 'Frameworks separados por coma (ej: "Next.js, Tailwind, Express")' },
        codingGuidelines: { type: 'string', maxLength: 2000, description: 'Instrucciones de codificación del proyecto. Se inyectan automáticamente en los prompts del Coder y Reviewer (max 2000 chars). Formato libre.' },
        userId: { type: 'string', description: 'UID del creador. Si no se pasa, usa el default.' },
        userName: { type: 'string', description: 'Nombre del creador. Si no se pasa, usa el default.' },
      },
      required: ['name', 'description', 'startDate', 'endDate'],
    },
    handler: async ({ name, description, startDate, endDate, status, repositories, languages, frameworks, codingGuidelines, userId, userName }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      if (!uid) return { error: 'Se requiere userId o configurar DEFAULT_USER_ID' };

      const now = Date.now();
      // Ensure at least one repo marked as default if repos provided
      let repos = repositories || [];
      if (repos.length > 0 && !repos.some(r => r.isDefault)) {
        repos = repos.map((r, i) => ({ ...r, isDefault: i === 0 }));
      }

      const projectData = {
        name,
        description,
        startDate,
        endDate,
        status: status || 'planned',
        repositories: repos,
        languages: languages || '',
        frameworks: frameworks || '',
        codingGuidelines: codingGuidelines || '',
        createdAt: now,
        createdBy: uid,
        members: {
          [uid]: {
            userId: uid,
            role: 'owner',
            addedAt: now,
            addedBy: uid,
          },
        },
      };

      const id = await create(PATH, projectData);
      return { id, message: `Proyecto "${name}" creado correctamente`, project: { id, ...projectData } };
    },
  },

  update_project: {
    description: 'Actualiza campos de un proyecto existente (nombre, descripción, fechas, estado, repositorios, lenguajes, frameworks, codingGuidelines).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        name: { type: 'string', description: 'Nuevo nombre' },
        description: { type: 'string', description: 'Nueva descripción' },
        startDate: { type: 'string', description: 'Nueva fecha inicio (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'Nueva fecha fin (YYYY-MM-DD)' },
        status: { type: 'string', enum: ['planned', 'active', 'completed', 'archived'], description: 'Nuevo estado' },
        repositories: {
          type: 'array',
          description: 'Repositorios GitHub (reemplaza los existentes)',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL del repositorio' },
              type: { type: 'string', enum: ['front', 'back', 'api', 'fullstack'], description: 'Tipo' },
              isDefault: { type: 'boolean', description: 'Repositorio por defecto' },
            },
            required: ['url', 'type'],
          },
        },
        languages: { type: 'string', description: 'Lenguajes de programación separados por coma' },
        frameworks: { type: 'string', description: 'Frameworks separados por coma' },
        codingGuidelines: { type: 'string', maxLength: 2000, description: 'Instrucciones de codificación del proyecto (max 2000 chars)' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, ...updates }) => {
      const project = await getById(PATH, projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { error: 'No se proporcionaron campos para actualizar' };

      if (clean.codingGuidelines !== undefined && clean.codingGuidelines.length > 2000) {
        return { error: 'codingGuidelines no puede superar 2000 caracteres' };
      }

      await update(PATH, projectId, clean);
      return { message: `Proyecto "${project.name}" actualizado`, updated: clean };
    },
  },

  delete_project: {
    description: 'Elimina un proyecto y todas sus tareas y sprints asociados (eliminación en cascada).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto a eliminar' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      const project = await getById(PATH, projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      // Cascade delete tasks
      const tasks = await getAll('tasks');
      const projectTasks = tasks.filter(t => t.projectId === projectId);
      for (const task of projectTasks) {
        await remove('tasks', task.id);
      }

      // Cascade delete sprints
      const sprints = await getAll('sprints');
      const projectSprints = sprints.filter(s => s.projectId === projectId);
      for (const sprint of projectSprints) {
        await remove('sprints', sprint.id);
      }

      // Cascade delete bugs
      const bugs = await getAll('bugs');
      const projectBugs = bugs.filter(b => b.projectId === projectId);
      for (const bug of projectBugs) {
        await remove('bugs', bug.id);
      }

      // Cascade delete proposals
      const proposals = await getAll('proposals');
      const projectProposals = proposals.filter(p => p.projectId === projectId);
      for (const proposal of projectProposals) {
        await remove('proposals', proposal.id);
      }

      await remove(PATH, projectId);
      return {
        message: `Proyecto "${project.name}" eliminado con ${projectTasks.length} tareas, ${projectSprints.length} sprints, ${projectBugs.length} bugs y ${projectProposals.length} propuestas`,
      };
    },
  },
};
