import { getAll, getById, create, update, remove, getDb } from '../firebase.js';
import { config } from '../config.js';

const PATH = 'tasks';

function calculatePriority(bizPoints, devPoints) {
  if (!devPoints || devPoints === 0) return 0;
  return Math.round((bizPoints / devPoints) * 10) / 10;
}

const VALID_STATUSES = ['to-do', 'in-progress', 'to-validate', 'validated', 'done'];
const FIBONACCI = [1, 2, 3, 5, 8, 13];
const BIZ_FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34];

/**
 * Detects circular dependencies in blockedBy/blocks graph.
 * Returns true if adding a dependency from `fromId` blocked by `toId` would create a cycle.
 */
async function hasCircularDependency(fromId, toId, visited = new Set()) {
  if (fromId === toId) return true;
  if (visited.has(toId)) return false;
  visited.add(toId);

  const task = await getById(PATH, toId);
  if (!task) return false;

  const blockedBy = task.blockedBy || [];
  for (const depId of blockedBy) {
    if (await hasCircularDependency(fromId, depId, visited)) return true;
  }
  return false;
}

/**
 * Validates that all IDs in an array exist as tasks in the given project.
 * Returns { valid: true } or { valid: false, missing: [...] }
 */
async function validateTaskIds(ids, projectId) {
  const missing = [];
  for (const id of ids) {
    const task = await getById(PATH, id);
    if (!task || task.projectId !== projectId) missing.push(id);
  }
  return missing.length === 0 ? { valid: true } : { valid: false, missing };
}

export const taskTools = {
  list_tasks: {
    description: 'Lista tareas con filtros opcionales por proyecto, sprint, estado, desarrollador o texto de búsqueda. Las tareas se devuelven ordenadas por prioridad (mayor primero).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filtrar por ID de proyecto' },
        sprintId: { type: 'string', description: 'Filtrar por ID de sprint' },
        status: { type: 'string', enum: VALID_STATUSES, description: 'Filtrar por estado' },
        developer: { type: 'string', description: 'Filtrar por UID del desarrollador asignado' },
        searchText: { type: 'string', description: 'Buscar por texto en el título' },
      },
    },
    handler: async ({ projectId, sprintId, status, developer, searchText }) => {
      let tasks = await getAll(PATH);

      if (projectId) tasks = tasks.filter(t => t.projectId === projectId);
      if (sprintId) tasks = tasks.filter(t => t.sprintId === sprintId);
      if (status) tasks = tasks.filter(t => t.status === status);
      if (developer) tasks = tasks.filter(t => t.developer === developer || t.coDeveloper === developer);
      if (searchText) {
        const lower = searchText.toLowerCase();
        tasks = tasks.filter(t => t.title && t.title.toLowerCase().includes(lower));
      }

      return tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    },
  },

  get_task: {
    description: 'Obtiene el detalle completo de una tarea por su ID, incluyendo User Story, puntos, criterios de aceptación e historial.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };
      return task;
    },
  },

  create_task: {
    description: 'Crea una nueva tarea con User Story, puntos de negocio/desarrollo, criterios de aceptación y asignación opcional. La prioridad se calcula automáticamente como bizPoints/devPoints.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID de la tarea' },
        projectId: { type: 'string', description: 'ID del proyecto al que pertenece' },
        title: { type: 'string', description: 'Título de la tarea (3-200 caracteres)' },
        userStory: {
          type: 'object',
          description: 'Historia de usuario con formato Como.../Quiero.../Para...',
          properties: {
            who: { type: 'string', description: 'Como... (quién es el actor, min 5 caracteres)' },
            what: { type: 'string', description: 'Quiero... (qué funcionalidad, min 5 caracteres)' },
            why: { type: 'string', description: 'Para... (qué beneficio, min 5 caracteres)' },
          },
          required: ['who', 'what', 'why'],
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de criterios de aceptación (mínimo 1)',
        },
        bizPoints: { type: 'number', enum: BIZ_FIBONACCI, description: 'Puntos de negocio (Fibonacci: 1,2,3,5,8,13,21,34). Valor de negocio de la tarea.' },
        devPoints: { type: 'number', enum: FIBONACCI, description: 'Puntos de desarrollo (Fibonacci: 1,2,3,5,8,13). Esfuerzo técnico.' },
        sprintId: { type: 'string', description: 'ID del sprint (opcional, se puede asignar después)' },
        developer: { type: 'string', description: 'UID del desarrollador asignado (opcional)' },
        coDeveloper: { type: 'string', description: 'UID del co-desarrollador (opcional)' },
        startDate: { type: 'string', description: 'Fecha de inicio (YYYY-MM-DD, opcional)' },
        endDate: { type: 'string', description: 'Fecha de fin (YYYY-MM-DD, opcional)' },
        status: { type: 'string', enum: VALID_STATUSES, description: 'Estado inicial. Default: to-do' },
        implementationPlan: {
          type: 'object',
          description: 'Plan de implementación para tareas complejas (opcional). Incluye enfoque técnico, pasos, cambios en modelo de datos, API, riesgos y fuera de alcance.',
          properties: {
            status: { type: 'string', enum: ['pending', 'in-progress', 'done'], description: 'Estado del plan. Default: pending' },
            approach: { type: 'string', description: 'Enfoque técnico general de la implementación' },
            steps: { type: 'array', items: { type: 'string' }, description: 'Pasos de implementación ordenados' },
            dataModelChanges: { type: 'string', description: 'Cambios necesarios en el modelo de datos' },
            apiChanges: { type: 'string', description: 'Cambios necesarios en la API' },
            risks: { type: 'string', description: 'Riesgos identificados' },
            outOfScope: { type: 'string', description: 'Elementos fuera del alcance de esta tarea' },
          },
        },
        tests: {
          type: 'array',
          description: 'Tests obligatorios de la tarea. Mínimo 1 test requerido. Se validan al cambiar estado: para pasar a to-validate todos deben estar definidos, para validated/done todos deben estar passed.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Descripción del test' },
              type: { type: 'string', enum: ['unit', 'integration', 'e2e', 'manual'], description: 'Tipo de test' },
              status: { type: 'string', enum: ['pending', 'passed', 'failed'], description: 'Estado del test. Default: pending' },
            },
            required: ['description'],
          },
        },
        attachments: {
          type: 'array',
          description: 'Archivos adjuntos (opcional). Cada adjunto necesita id, name, url, storagePath, uploadedAt, uploadedBy.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID único del adjunto' },
              name: { type: 'string', description: 'Nombre del archivo' },
              url: { type: 'string', description: 'URL pública de descarga' },
              storagePath: { type: 'string', description: 'Ruta en Firebase Storage' },
              uploadedAt: { type: 'number', description: 'Timestamp de subida' },
              uploadedBy: { type: 'string', description: 'UID del usuario que subió' },
            },
            required: ['id', 'name', 'url', 'storagePath', 'uploadedAt', 'uploadedBy'],
          },
        },
        parentTaskId: { type: 'string', description: 'ID de la tarea padre si esta es una subtarea (opcional)' },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'IDs de tareas que bloquean esta tarea (opcional)' },
        blocks: { type: 'array', items: { type: 'string' }, description: 'IDs de tareas que esta tarea bloquea (opcional)' },
        userId: { type: 'string', description: 'UID del creador. Si no se pasa, usa el default.' },
        userName: { type: 'string', description: 'Nombre del creador.' },
      },
      required: ['projectId', 'title', 'userStory', 'acceptanceCriteria', 'bizPoints', 'devPoints', 'tests'],
    },
    handler: async ({ projectId, title, userStory, acceptanceCriteria, bizPoints, devPoints, sprintId, developer, coDeveloper, startDate, endDate, status, implementationPlan, tests, attachments, parentTaskId, blockedBy, blocks, userId, userName }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      if (!FIBONACCI.includes(devPoints)) {
        return { error: `devPoints debe ser Fibonacci: ${FIBONACCI.join(', ')}` };
      }

      if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
        return { error: 'Se requiere al menos un criterio de aceptación' };
      }

      if (!tests || tests.length === 0) {
        return { error: 'Se requiere al menos un test. Define tests con description y tipo (unit/integration/e2e/manual).' };
      }

      // Validate parentTaskId exists in same project
      if (parentTaskId) {
        const parentTask = await getById(PATH, parentTaskId);
        if (!parentTask || parentTask.projectId !== projectId) {
          return { error: `Tarea padre ${parentTaskId} no encontrada en el proyecto ${projectId}` };
        }
      }

      // Validate blockedBy IDs exist in same project
      if (blockedBy && blockedBy.length > 0) {
        const result = await validateTaskIds(blockedBy, projectId);
        if (!result.valid) {
          return { error: `Tareas en blockedBy no encontradas en el proyecto: ${result.missing.join(', ')}` };
        }
      }

      // Validate blocks IDs exist in same project
      if (blocks && blocks.length > 0) {
        const result = await validateTaskIds(blocks, projectId);
        if (!result.valid) {
          return { error: `Tareas en blocks no encontradas en el proyecto: ${result.missing.join(', ')}` };
        }
      }

      // Check for circular dependency when both blockedBy and blocks are provided
      if (blockedBy && blockedBy.length > 0 && blocks && blocks.length > 0) {
        // Direct overlap: a task can't both block and be blocked by the same task
        const overlap = blockedBy.filter(id => blocks.includes(id));
        if (overlap.length > 0) {
          return { error: `Dependencia circular detectada: las tareas ${overlap.join(', ')} están en blockedBy y blocks simultáneamente` };
        }
        // Transitive: check if any task in blocks is transitively blocked by a task in blockedBy
        for (const blockedId of blocks) {
          for (const blockerId of blockedBy) {
            if (await hasCircularDependency(blockedId, blockerId)) {
              return { error: `Dependencia circular detectada: ${blockedId} (en blocks) ya depende transitivamente de ${blockerId} (en blockedBy)` };
            }
          }
        }
      }

      const now = Date.now();
      const priority = calculatePriority(bizPoints, devPoints);

      const taskData = {
        title,
        projectId,
        sprintId: sprintId || '',
        userStory,
        acceptanceCriteria: acceptanceCriteria.filter(c => c.trim().length > 0),
        bizPoints,
        devPoints,
        priority,
        developer: developer || '',
        coDeveloper: coDeveloper || '',
        startDate: startDate || '',
        endDate: endDate || '',
        status: status || 'to-do',
        implementationPlan: implementationPlan ? {
          status: implementationPlan.status || 'pending',
          approach: implementationPlan.approach || '',
          steps: implementationPlan.steps || [],
          dataModelChanges: implementationPlan.dataModelChanges || '',
          apiChanges: implementationPlan.apiChanges || '',
          risks: implementationPlan.risks || '',
          outOfScope: implementationPlan.outOfScope || '',
        } : null,
        tests: tests.map(t => ({
          description: t.description,
          type: t.type || 'unit',
          status: t.status || 'pending',
        })),
        attachments: attachments || [],
        parentTaskId: parentTaskId || '',
        blockedBy: blockedBy || [],
        blocks: blocks || [],
        subtaskIds: [],
        decomposed: false,
        createdAt: now,
        updatedAt: now,
        createdBy: uid || '',
        createdByName: uname || '',
        history: {},
      };

      const id = await create(PATH, taskData);

      // Add creation history entry
      const historyRef = getDb().ref(`${PATH}/${id}/history`).push();
      await historyRef.set({
        id: historyRef.key,
        timestamp: now,
        userId: uid || '',
        userName: uname || '',
        field: 'task',
        oldValue: null,
        newValue: title,
        action: 'create',
      });

      // Update parent task's subtaskIds
      if (parentTaskId) {
        const parentTask = await getById(PATH, parentTaskId);
        if (parentTask) {
          const existingSubtaskIds = parentTask.subtaskIds || [];
          await update(PATH, parentTaskId, {
            subtaskIds: [...existingSubtaskIds, id],
            updatedAt: now,
          });
        }
      }

      // Update inverse blocks relationship: for each task in blockedBy, add this task to their blocks
      if (blockedBy && blockedBy.length > 0) {
        for (const blockerId of blockedBy) {
          const blockerTask = await getById(PATH, blockerId);
          if (blockerTask) {
            const existingBlocks = blockerTask.blocks || [];
            if (!existingBlocks.includes(id)) {
              await update(PATH, blockerId, {
                blocks: [...existingBlocks, id],
                updatedAt: now,
              });
            }
          }
        }
      }

      // Update inverse blockedBy relationship: for each task in blocks, add this task to their blockedBy
      if (blocks && blocks.length > 0) {
        for (const blockedId of blocks) {
          const blockedTask = await getById(PATH, blockedId);
          if (blockedTask) {
            const existingBlockedBy = blockedTask.blockedBy || [];
            if (!existingBlockedBy.includes(id)) {
              await update(PATH, blockedId, {
                blockedBy: [...existingBlockedBy, id],
                updatedAt: now,
              });
            }
          }
        }
      }

      // Send notification to assigned developer
      if (developer && developer !== uid) {
        try {
          const notifRef = getDb().ref(`notifications/${developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: developer,
            title: 'Nueva tarea asignada',
            message: `Se te ha asignado la tarea "${title}" en el proyecto "${project.name}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${projectId}`,
          });
        } catch { /* notification failure shouldn't block task creation */ }
      }

      return { id, message: `Tarea "${title}" creada con prioridad ${priority}`, task: { id, ...taskData } };
    },
  },

  update_task: {
    description: 'Actualiza campos de una tarea existente. Recalcula prioridad si se cambian los puntos. Registra el cambio en el historial.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        title: { type: 'string', description: 'Nuevo título' },
        userStory: {
          type: 'object',
          properties: {
            who: { type: 'string' },
            what: { type: 'string' },
            why: { type: 'string' },
          },
        },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        bizPoints: { type: 'number', enum: BIZ_FIBONACCI, description: 'Nuevos puntos de negocio (Fibonacci: 1,2,3,5,8,13,21,34)' },
        devPoints: { type: 'number', enum: FIBONACCI, description: 'Nuevos puntos de desarrollo (Fibonacci)' },
        sprintId: { type: 'string', description: 'Nuevo sprint ID (vacío para desasignar)' },
        developer: { type: 'string', description: 'Nuevo desarrollador UID' },
        coDeveloper: { type: 'string', description: 'Nuevo co-desarrollador UID' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        status: { type: 'string', enum: VALID_STATUSES },
        implementationPlan: {
          type: 'object',
          description: 'Plan de implementación (reemplaza el existente)',
          properties: {
            status: { type: 'string', enum: ['pending', 'in-progress', 'done'] },
            approach: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            dataModelChanges: { type: 'string' },
            apiChanges: { type: 'string' },
            risks: { type: 'string' },
            outOfScope: { type: 'string' },
          },
        },
        tests: {
          type: 'array',
          description: 'Tests de la tarea (reemplaza los existentes). Mínimo 1 requerido.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Descripción del test' },
              type: { type: 'string', enum: ['unit', 'integration', 'e2e', 'manual'], description: 'Tipo de test' },
              status: { type: 'string', enum: ['pending', 'passed', 'failed'], description: 'Estado del test' },
            },
            required: ['description'],
          },
        },
        attachments: {
          type: 'array',
          description: 'Archivos adjuntos (reemplaza los existentes)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              url: { type: 'string' },
              storagePath: { type: 'string' },
              uploadedAt: { type: 'number' },
              uploadedBy: { type: 'string' },
            },
          },
        },
        parentTaskId: { type: 'string', description: 'ID de la tarea padre (para convertir en subtarea)' },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'IDs de tareas que bloquean esta tarea' },
        blocks: { type: 'array', items: { type: 'string' }, description: 'IDs de tareas que esta tarea bloquea' },
        subtaskIds: { type: 'array', items: { type: 'string' }, description: 'IDs de subtareas (se actualiza automáticamente)' },
        decomposed: { type: 'boolean', description: 'Indica si la tarea fue descompuesta en subtareas' },
        userId: { type: 'string', description: 'UID del usuario que realiza el cambio' },
        userName: { type: 'string', description: 'Nombre del usuario que realiza el cambio' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId, userId, userName, ...updates }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const now = Date.now();

      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { error: 'No se proporcionaron campos para actualizar' };

      // Validate blockedBy IDs exist in same project
      if (clean.blockedBy && clean.blockedBy.length > 0) {
        const result = await validateTaskIds(clean.blockedBy, task.projectId);
        if (!result.valid) {
          return { error: `Tareas en blockedBy no encontradas en el proyecto: ${result.missing.join(', ')}` };
        }
        // Check for circular dependencies: if taskId wants to be blocked by depId,
        // check if depId is already (transitively) blocked by taskId
        for (const depId of clean.blockedBy) {
          if (await hasCircularDependency(taskId, depId)) {
            return { error: `Dependencia circular detectada: ${taskId} no puede ser bloqueada por ${depId}` };
          }
        }
      }

      // Validate blocks IDs exist in same project
      if (clean.blocks && clean.blocks.length > 0) {
        const result = await validateTaskIds(clean.blocks, task.projectId);
        if (!result.valid) {
          return { error: `Tareas en blocks no encontradas en el proyecto: ${result.missing.join(', ')}` };
        }
        // Check for circular dependencies: if taskId wants to block depId,
        // check if taskId is already (transitively) blocked by depId
        for (const depId of clean.blocks) {
          if (await hasCircularDependency(depId, taskId)) {
            return { error: `Dependencia circular detectada: ${taskId} no puede bloquear a ${depId}` };
          }
        }
      }

      // Cross-check: when both blockedBy and blocks are updated simultaneously
      if (clean.blockedBy && clean.blockedBy.length > 0 && clean.blocks && clean.blocks.length > 0) {
        // Direct overlap: a task can't both block and be blocked by the same task
        const overlap = clean.blockedBy.filter(id => clean.blocks.includes(id));
        if (overlap.length > 0) {
          return { error: `Dependencia circular detectada: las tareas ${overlap.join(', ')} están en blockedBy y blocks simultáneamente` };
        }
        // Transitive: check if any task in blocks is transitively blocked by a task in blockedBy
        for (const blockedId of clean.blocks) {
          for (const blockerId of clean.blockedBy) {
            if (await hasCircularDependency(blockedId, blockerId)) {
              return { error: `Dependencia circular detectada: ${blockedId} (en blocks) ya depende transitivamente de ${blockerId} (en blockedBy)` };
            }
          }
        }
      }

      // Validate parentTaskId if being set
      if (clean.parentTaskId) {
        const parentTask = await getById(PATH, clean.parentTaskId);
        if (!parentTask || parentTask.projectId !== task.projectId) {
          return { error: `Tarea padre ${clean.parentTaskId} no encontrada en el proyecto ${task.projectId}` };
        }
      }

      // Recalculate priority if points changed
      const biz = clean.bizPoints ?? task.bizPoints;
      const dev = clean.devPoints ?? task.devPoints;
      if (clean.bizPoints !== undefined || clean.devPoints !== undefined) {
        clean.priority = calculatePriority(biz, dev);
      }

      clean.updatedAt = now;
      await update(PATH, taskId, clean);

      // Sync parentTaskId changes: remove from old parent, add to new parent
      if (clean.parentTaskId !== undefined && clean.parentTaskId !== (task.parentTaskId || '')) {
        // Remove from old parent's subtaskIds
        const oldParentId = task.parentTaskId || '';
        if (oldParentId) {
          const oldParent = await getById(PATH, oldParentId);
          if (oldParent) {
            const oldSubtaskIds = (oldParent.subtaskIds || []).filter(id => id !== taskId);
            await update(PATH, oldParentId, { subtaskIds: oldSubtaskIds, updatedAt: now });
          }
        }
        // Add to new parent's subtaskIds
        const newParentId = clean.parentTaskId;
        if (newParentId) {
          const newParent = await getById(PATH, newParentId);
          if (newParent) {
            const newSubtaskIds = newParent.subtaskIds || [];
            if (!newSubtaskIds.includes(taskId)) {
              await update(PATH, newParentId, { subtaskIds: [...newSubtaskIds, taskId], updatedAt: now });
            }
          }
        }
      }

      // Sync inverse blockedBy/blocks relationships
      if (clean.blockedBy !== undefined) {
        const oldBlockedBy = task.blockedBy || [];
        const newBlockedBy = clean.blockedBy || [];
        // Remove taskId from blocks of old blockers that are no longer in the list
        const removedBlockers = oldBlockedBy.filter(id => !newBlockedBy.includes(id));
        for (const blockerId of removedBlockers) {
          const blockerTask = await getById(PATH, blockerId);
          if (blockerTask) {
            const updatedBlocks = (blockerTask.blocks || []).filter(id => id !== taskId);
            await update(PATH, blockerId, { blocks: updatedBlocks, updatedAt: now });
          }
        }
        // Add taskId to blocks of new blockers
        const addedBlockers = newBlockedBy.filter(id => !oldBlockedBy.includes(id));
        for (const blockerId of addedBlockers) {
          const blockerTask = await getById(PATH, blockerId);
          if (blockerTask) {
            const existingBlocks = blockerTask.blocks || [];
            if (!existingBlocks.includes(taskId)) {
              await update(PATH, blockerId, { blocks: [...existingBlocks, taskId], updatedAt: now });
            }
          }
        }
      }

      if (clean.blocks !== undefined) {
        const oldBlocks = task.blocks || [];
        const newBlocks = clean.blocks || [];
        // Remove taskId from blockedBy of old blocked tasks no longer in the list
        const removedBlocked = oldBlocks.filter(id => !newBlocks.includes(id));
        for (const blockedId of removedBlocked) {
          const blockedTask = await getById(PATH, blockedId);
          if (blockedTask) {
            const updatedBlockedBy = (blockedTask.blockedBy || []).filter(id => id !== taskId);
            await update(PATH, blockedId, { blockedBy: updatedBlockedBy, updatedAt: now });
          }
        }
        // Add taskId to blockedBy of new blocked tasks
        const addedBlocked = newBlocks.filter(id => !oldBlocks.includes(id));
        for (const blockedId of addedBlocked) {
          const blockedTask = await getById(PATH, blockedId);
          if (blockedTask) {
            const existingBlockedBy = blockedTask.blockedBy || [];
            if (!existingBlockedBy.includes(taskId)) {
              await update(PATH, blockedId, { blockedBy: [...existingBlockedBy, taskId], updatedAt: now });
            }
          }
        }
      }

      // Add history entries for each changed field
      for (const [field, newValue] of Object.entries(clean)) {
        if (field === 'updatedAt' || field === 'priority') continue;
        const oldValue = task[field];
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;

        const historyRef = getDb().ref(`${PATH}/${taskId}/history`).push();
        await historyRef.set({
          id: historyRef.key,
          timestamp: now,
          userId: uid || '',
          userName: uname || '',
          field,
          oldValue: oldValue ?? null,
          newValue,
          action: 'update',
        });
      }

      // Notify on status change
      if (clean.status && clean.status !== task.status && task.developer && task.developer !== uid) {
        try {
          const project = await getById('projects', task.projectId);
          const notifRef = getDb().ref(`notifications/${task.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: task.developer,
            title: 'Estado de tarea actualizado',
            message: `La tarea "${task.title}" cambió de "${task.status}" a "${clean.status}" en "${project?.name || ''}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${task.projectId}`,
          });
        } catch { /* */ }
      }

      // Notify on reassignment
      if (clean.developer && clean.developer !== task.developer && clean.developer !== uid) {
        try {
          const project = await getById('projects', task.projectId);
          const notifRef = getDb().ref(`notifications/${clean.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: clean.developer,
            title: 'Tarea reasignada',
            message: `Se te ha asignado la tarea "${task.title}" en "${project?.name || ''}"`,
            type: 'info',
            read: false,
            date: now,
            link: `/projects/${task.projectId}`,
          });
        } catch { /* */ }
      }

      return { message: `Tarea "${task.title}" actualizada`, updated: clean };
    },
  },

  delete_task: {
    description: 'Elimina una tarea y todos sus comentarios asociados.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea a eliminar' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      // Delete associated comments
      try {
        await getDb().ref(`comments/${taskId}`).remove();
      } catch { /* */ }

      await remove(PATH, taskId);

      // Notify assigned developer
      if (task.developer) {
        try {
          const project = await getById('projects', task.projectId);
          const notifRef = getDb().ref(`notifications/${task.developer}`).push();
          await notifRef.set({
            id: notifRef.key,
            userId: task.developer,
            title: 'Tarea eliminada',
            message: `La tarea "${task.title}" fue eliminada del proyecto "${project?.name || ''}"`,
            type: 'warning',
            read: false,
            date: Date.now(),
          });
        } catch { /* */ }
      }

      return { message: `Tarea "${task.title}" eliminada` };
    },
  },

  change_task_status: {
    description: 'Cambia el estado de una tarea. Estados válidos: to-do, in-progress, to-validate, validated, done. Registra el cambio en el historial y notifica al desarrollador.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        newStatus: { type: 'string', enum: VALID_STATUSES, description: 'Nuevo estado' },
        force: { type: 'boolean', description: 'Ignora las validaciones de tests (sólo para automatizaciones)' },
        userId: { type: 'string', description: 'UID del usuario que cambia el estado' },
        userName: { type: 'string', description: 'Nombre del usuario' },
      },
      required: ['taskId', 'newStatus'],
    },
    handler: async ({ taskId, newStatus, userId, userName, force }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      if (task.status === newStatus) return { message: `La tarea ya está en estado "${newStatus}"` };

      // Validate tests before status transitions
      if (!force) {
        const tests = task.tests || [];
        if (['to-validate', 'validated', 'done'].includes(newStatus)) {
          if (tests.length === 0) {
            return { error: `No se puede pasar a "${newStatus}": la tarea no tiene tests definidos. Añade al menos un test con update_task.` };
          }
        }
        if (['validated', 'done'].includes(newStatus)) {
          const failed = tests.filter(t => t.status === 'failed');
          const pending = tests.filter(t => t.status === 'pending');
          if (failed.length > 0) {
            return { error: `No se puede pasar a "${newStatus}": hay ${failed.length} test(s) fallidos. Corrígelos primero.` };
          }
          if (pending.length > 0) {
            return { error: `No se puede pasar a "${newStatus}": hay ${pending.length} test(s) pendientes. Ejecútalos y actualiza su estado.` };
          }
        }
      }

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const now = Date.now();

      await update(PATH, taskId, { status: newStatus, updatedAt: now });

      // When marking as done, clean this task from blockedBy of dependent tasks
      if (newStatus === 'done') {
        const blocksIds = task.blocks || [];
        for (const dependentId of blocksIds) {
          const dependentTask = await getById(PATH, dependentId);
          if (dependentTask) {
            const updatedBlockedBy = (dependentTask.blockedBy || []).filter(id => id !== taskId);
            await update(PATH, dependentId, { blockedBy: updatedBlockedBy, updatedAt: now });
          }
        }
      }

      // History
      const historyRef = getDb().ref(`${PATH}/${taskId}/history`).push();
      await historyRef.set({
        id: historyRef.key,
        timestamp: now,
        userId: uid || '',
        userName: uname || '',
        field: 'status',
        oldValue: task.status,
        newValue: newStatus,
        action: 'update',
      });

      return { message: `Tarea "${task.title}": ${task.status} → ${newStatus}` };
    },
  },

  assign_task: {
    description: 'Asigna o reasigna un desarrollador y/o co-desarrollador a una tarea.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea' },
        developer: { type: 'string', description: 'UID del desarrollador principal (vacío para desasignar)' },
        coDeveloper: { type: 'string', description: 'UID del co-desarrollador (vacío para desasignar)' },
        userId: { type: 'string', description: 'UID del usuario que asigna' },
        userName: { type: 'string', description: 'Nombre del usuario que asigna' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId, developer, coDeveloper, userId, userName }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;
      const now = Date.now();
      const updates = { updatedAt: now };

      if (developer !== undefined) updates.developer = developer;
      if (coDeveloper !== undefined) updates.coDeveloper = coDeveloper;

      await update(PATH, taskId, updates);

      // History & notifications for developer change
      if (developer !== undefined && developer !== task.developer) {
        const historyRef = getDb().ref(`${PATH}/${taskId}/history`).push();
        await historyRef.set({
          id: historyRef.key,
          timestamp: now,
          userId: uid || '',
          userName: uname || '',
          field: 'developer',
          oldValue: task.developer || null,
          newValue: developer,
          action: 'update',
        });

        if (developer && developer !== uid) {
          try {
            const project = await getById('projects', task.projectId);
            const notifRef = getDb().ref(`notifications/${developer}`).push();
            await notifRef.set({
              id: notifRef.key,
              userId: developer,
              title: 'Tarea asignada',
              message: `Se te ha asignado la tarea "${task.title}" en "${project?.name || ''}"`,
              type: 'info',
              read: false,
              date: now,
              link: `/projects/${task.projectId}`,
            });
          } catch { /* */ }
        }
      }

      return { message: `Asignación de "${task.title}" actualizada`, updated: updates };
    },
  },

  list_subtasks: {
    description: 'Lista las subtareas directas de una tarea padre. Devuelve las subtareas ordenadas por prioridad.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID de la tarea padre' },
      },
      required: ['taskId'],
    },
    handler: async ({ taskId }) => {
      const task = await getById(PATH, taskId);
      if (!task) return { error: `Tarea ${taskId} no encontrada` };

      const subtaskIds = task.subtaskIds || [];
      if (subtaskIds.length === 0) return { subtasks: [], message: 'La tarea no tiene subtareas' };

      const subtasks = [];
      for (const subId of subtaskIds) {
        const sub = await getById(PATH, subId);
        if (sub) subtasks.push(sub);
      }

      return {
        parentTaskId: taskId,
        subtasks: subtasks.sort((a, b) => (b.priority || 0) - (a.priority || 0)),
        total: subtasks.length,
      };
    },
  },

  move_tasks_to_sprint: {
    description: 'Mueve múltiples tareas a un sprint específico. Útil para planificación de sprints.',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Lista de IDs de tareas a mover' },
        sprintId: { type: 'string', description: 'ID del sprint destino (vacío para desasignar del sprint)' },
      },
      required: ['taskIds', 'sprintId'],
    },
    handler: async ({ taskIds, sprintId }) => {
      if (sprintId) {
        const sprint = await getById('sprints', sprintId);
        if (!sprint) return { error: `Sprint ${sprintId} no encontrado` };
      }

      let moved = 0;
      const errors = [];
      for (const taskId of taskIds) {
        const task = await getById(PATH, taskId);
        if (!task) {
          errors.push(`Tarea ${taskId} no encontrada`);
          continue;
        }
        await update(PATH, taskId, { sprintId, updatedAt: Date.now() });
        moved++;
      }

      return {
        message: `${moved} tareas movidas al sprint${sprintId ? '' : ' (desasignadas)'}`,
        moved,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  },
};

// Exported for testing
export { hasCircularDependency, validateTaskIds };
