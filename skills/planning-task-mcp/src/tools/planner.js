import { getAll, getById, create, getDb } from '../firebase.js';
import { config } from '../config.js';

/**
 * Planner tools - Intelligent sprint/task planning from natural language documents.
 *
 * IMPORTANT: These tools return structured data that the AI must use to actually
 * create the sprints and tasks via the corresponding create tools. The planner
 * tools themselves are "read-only analysis" tools that help the AI understand
 * HOW to break down work logically. The AI is responsible for:
 *   1. Calling plan_from_document to analyze the requirements
 *   2. Reviewing the returned plan
 *   3. Using create_sprint + create_task to implement the plan
 *   4. Reporting back to the user with what was created
 */

const FIBONACCI = [1, 2, 3, 5, 8, 13];
const BIZ_FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34];

function nearestFibonacci(n, scale = FIBONACCI) {
  let closest = scale[0];
  for (const f of scale) {
    if (Math.abs(f - n) < Math.abs(closest - n)) closest = f;
  }
  return closest;
}

function calculateSprintCapacity(durationDays, teamSize) {
  // Assume ~5-6 productive dev-points per person per week
  const weeks = durationDays / 7;
  return Math.floor(weeks * 5.5 * Math.max(teamSize, 1));
}

export const plannerTools = {
  plan_from_document: {
    description: `Analiza un documento de requisitos en lenguaje natural y genera un plan de sprints y tareas estructurado para implementarlo en el proyecto.

COMPORTAMIENTO INTELIGENTE:
- Divide el trabajo en sprints proporcionales a la duración del proyecto.
- No crea 4 tareas para 2 semanas si no es lógico; agrupa funcionalidad relacionada.
- Cada tarea incluye User Story (Como.../Quiero.../Para...), descripción técnica y criterios de aceptación.
- Calcula puntos de negocio y desarrollo automáticamente según la complejidad percibida.
- Ordena por dependencias lógicas (lo que se necesita primero va en sprints anteriores).

ESTE TOOL DEVUELVE UN PLAN. La IA debe luego usar create_sprint y create_task para materializar el plan en la base de datos.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto donde se implementará el plan' },
        document: { type: 'string', description: 'Documento de requisitos en lenguaje natural. Puede ser una descripción de funcionalidad, lista de features, brief de producto, etc.' },
        sprintDurationDays: { type: 'number', description: 'Duración de cada sprint en días. Default: 14 (2 semanas)' },
        teamSize: { type: 'number', description: 'Número de desarrolladores disponibles. Default: se calcula de los miembros del proyecto.' },
        maxTasksPerSprint: { type: 'number', description: 'Máximo de tareas por sprint. Default: calculado según duración y equipo.' },
      },
      required: ['projectId', 'document'],
    },
    handler: async ({ projectId, document, sprintDurationDays, teamSize, maxTasksPerSprint }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      // Get existing context
      const [existingTasks, existingSprints, users] = await Promise.all([
        getAll('tasks'),
        getAll('sprints'),
        getAll('users'),
      ]);

      const projectTasks = existingTasks.filter(t => t.projectId === projectId);
      const projectSprints = existingSprints.filter(s => s.projectId === projectId);

      // Calculate team size from project members if not provided
      let actualTeamSize = teamSize;
      if (!actualTeamSize && project.members) {
        actualTeamSize = Object.keys(project.members).length;
      }
      actualTeamSize = actualTeamSize || 1;

      const duration = sprintDurationDays || 14;
      const capacity = calculateSprintCapacity(duration, actualTeamSize);
      const maxTasks = maxTasksPerSprint || Math.max(Math.ceil(capacity / 3), 4); // At least 4 tasks

      // Get team member info for assignment suggestions
      const memberIds = project.members ? Object.keys(project.members) : [];
      const teamMembers = [];
      for (const uid of memberIds) {
        const user = users.find(u => (u.id || u.uid) === uid);
        if (user) {
          const currentLoad = projectTasks
            .filter(t => t.developer === uid && t.status !== 'done')
            .reduce((sum, t) => sum + (t.devPoints || 0), 0);
          teamMembers.push({
            userId: uid,
            displayName: user.displayName || uid,
            currentLoad,
          });
        }
      }

      // Return context for the AI to use for intelligent planning
      return {
        _instruction: `PLAN DE ANÁLISIS - La IA debe leer este contexto y generar sprints/tareas inteligentemente.

LEE el documento proporcionado y descompón en:
1. ÉPICAS (funcionalidades grandes)
2. TAREAS dentro de cada épica
3. SPRINTS agrupando tareas por lógica, no por cantidad arbitraria

REGLAS DE PLANIFICACIÓN:
- Cada sprint tiene ${duration} días y capacidad ~${capacity} dev-points.
- Máximo ~${maxTasks} tareas por sprint (pero puede ser menos si son complejas).
- Las tareas deben tener dependencias lógicas: infraestructura primero, luego backend, luego frontend, luego integración.
- NUNCA crees tareas artificialmente granulares solo para "llenar" un sprint.
- Si una funcionalidad es compleja, es MEJOR una tarea de 8 o 13 puntos que 4 tareas de 2 puntos que no tienen sentido individualmente.
- Cada tarea DEBE tener sentido como unidad de trabajo independiente y entregable.

FORMATO DE CADA TAREA:
- title: Título descriptivo y técnico
- userStory: { who: "Como [actor]", what: "quiero [funcionalidad]", why: "para [beneficio]" }
- acceptanceCriteria: [criterios concretos y verificables]
- bizPoints: Fibonacci (1,2,3,5,8,13,21,34) - valor de negocio
- devPoints: Fibonacci (1,2,3,5,8,13) - esfuerzo técnico

PARA TAREAS COMPLEJAS (devPoints >= 8), INCLUYE implementationPlan:
- approach: Enfoque técnico general
- steps: Pasos de implementación ordenados
- dataModelChanges: Cambios en el modelo de datos/esquema
- apiChanges: Cambios en endpoints o APIs
- risks: Riesgos técnicos identificados
- outOfScope: Lo que NO se incluye en esta tarea

DESPUÉS de generar el plan, USA create_full_plan para ejecutarlo de una vez.`,

        projectContext: {
          projectId,
          projectName: project.name,
          projectStatus: project.status,
          projectStartDate: project.startDate,
          projectEndDate: project.endDate,
          existingSprintsCount: projectSprints.length,
          existingTasksCount: projectTasks.length,
          nextSprintNumber: projectSprints.length + 1,
        },

        teamContext: {
          teamSize: actualTeamSize,
          members: teamMembers,
          sprintDurationDays: duration,
          estimatedCapacityPerSprint: capacity,
          maxTasksPerSprint: maxTasks,
        },

        existingSprints: projectSprints.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          startDate: s.startDate,
          endDate: s.endDate,
        })),

        document,

        fibonacciScale: {
          1: 'Muy Simple - Cambio de texto, config, fix trivial (1-2 horas)',
          2: 'Simple - Componente básico, CRUD simple, ajuste menor (medio día)',
          3: 'Medio - Feature pequeña completa, integración simple (1 día)',
          5: 'Moderado - Feature mediana, lógica de negocio, testing (2-3 días)',
          8: 'Complejo - Feature grande, múltiples componentes, integración compleja (1 semana)',
          13: 'Muy Complejo - Sistema completo, arquitectura nueva, refactor mayor (1-2 semanas)',
        },
      };
    },
  },

  create_full_plan: {
    description: `Crea un plan completo ejecutándolo directamente: crea los sprints y todas las tareas de una vez a partir de un plan estructurado. Recibe un array de sprints con sus tareas y los crea todos en la base de datos.

Usar DESPUÉS de que la IA haya analizado el documento con plan_from_document y tenga el plan listo.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        sprints: {
          type: 'array',
          description: 'Array de sprints con sus tareas',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nombre del sprint' },
              startDate: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD)' },
              endDate: { type: 'string', description: 'Fecha fin (YYYY-MM-DD)' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    userStory: {
                      type: 'object',
                      properties: {
                        who: { type: 'string' },
                        what: { type: 'string' },
                        why: { type: 'string' },
                      },
                      required: ['who', 'what', 'why'],
                    },
                    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
                    bizPoints: { type: 'number' },
                    devPoints: { type: 'number' },
                    developer: { type: 'string', description: 'UID del developer sugerido (opcional)' },
                    status: { type: 'string', description: 'Default: to-do' },
                    tests: {
                      type: 'array',
                      description: 'Tests de la tarea (opcional en plan, se generan automáticamente si no se proporcionan)',
                      items: {
                        type: 'object',
                        properties: {
                          description: { type: 'string' },
                          type: { type: 'string', enum: ['unit', 'integration', 'e2e', 'manual'] },
                          status: { type: 'string', enum: ['pending', 'passed', 'failed'] },
                        },
                        required: ['description'],
                      },
                    },
                    blockedBy: { type: 'array', items: { type: 'string' }, description: 'IDs de tareas que bloquean esta tarea (opcional)' },
                    blocks: { type: 'array', items: { type: 'string' }, description: 'IDs de tareas que esta tarea bloquea (opcional)' },
                    implementationPlan: {
                      type: 'object',
                      description: 'Plan técnico para tareas complejas (devPoints >= 8)',
                      properties: {
                        approach: { type: 'string' },
                        steps: { type: 'array', items: { type: 'string' } },
                        dataModelChanges: { type: 'string' },
                        apiChanges: { type: 'string' },
                        risks: { type: 'string' },
                        outOfScope: { type: 'string' },
                      },
                    },
                  },
                  required: ['title', 'userStory', 'acceptanceCriteria', 'bizPoints', 'devPoints'],
                },
              },
            },
            required: ['name', 'startDate', 'endDate', 'tasks'],
          },
        },
        userId: { type: 'string', description: 'UID del creador' },
        userName: { type: 'string', description: 'Nombre del creador' },
      },
      required: ['projectId', 'sprints'],
    },
    handler: async ({ projectId, sprints, userId, userName }) => {
      const uid = userId || config.defaultUserId;
      const uname = userName || config.defaultUserName;

      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const results = {
        sprintsCreated: [],
        tasksCreated: [],
        totalSprints: 0,
        totalTasks: 0,
        totalDevPoints: 0,
        errors: [],
      };

      for (const sprintPlan of sprints) {
        // Create sprint
        const now = Date.now();
        const sprintData = {
          name: sprintPlan.name,
          projectId,
          startDate: sprintPlan.startDate,
          endDate: sprintPlan.endDate,
          status: 'planned',
          createdAt: now,
          createdBy: uid || '',
        };

        let sprintId;
        try {
          sprintId = await create('sprints', sprintData);
          results.sprintsCreated.push({ id: sprintId, name: sprintPlan.name });
          results.totalSprints++;
        } catch (err) {
          results.errors.push(`Error creando sprint "${sprintPlan.name}": ${err.message}`);
          continue;
        }

        // Create tasks for this sprint
        for (const taskPlan of (sprintPlan.tasks || [])) {
          const devPoints = FIBONACCI.includes(taskPlan.devPoints)
            ? taskPlan.devPoints
            : nearestFibonacci(taskPlan.devPoints);
          const bizPoints = BIZ_FIBONACCI.includes(taskPlan.bizPoints)
            ? taskPlan.bizPoints
            : nearestFibonacci(taskPlan.bizPoints, BIZ_FIBONACCI);

          const priority = devPoints > 0 ? Math.round((bizPoints / devPoints) * 10) / 10 : 0;
          const taskNow = Date.now();

          // Auto-generate a default test from acceptance criteria if none provided
          const tests = taskPlan.tests && taskPlan.tests.length > 0
            ? taskPlan.tests.map(t => ({ description: t.description, type: t.type || 'manual', status: t.status || 'pending' }))
            : [{ description: `Verificar: ${taskPlan.title}`, type: 'manual', status: 'pending' }];

          const taskData = {
            title: taskPlan.title,
            projectId,
            sprintId,
            userStory: taskPlan.userStory,
            acceptanceCriteria: (taskPlan.acceptanceCriteria || []).filter(c => c && c.trim().length > 0),
            bizPoints,
            devPoints,
            priority,
            developer: taskPlan.developer || '',
            coDeveloper: '',
            startDate: sprintPlan.startDate,
            endDate: sprintPlan.endDate,
            implementationPlan: taskPlan.implementationPlan ? {
              status: 'pending',
              approach: taskPlan.implementationPlan.approach || '',
              steps: taskPlan.implementationPlan.steps || [],
              dataModelChanges: taskPlan.implementationPlan.dataModelChanges || '',
              apiChanges: taskPlan.implementationPlan.apiChanges || '',
              risks: taskPlan.implementationPlan.risks || '',
              outOfScope: taskPlan.implementationPlan.outOfScope || '',
            } : null,
            tests,
            attachments: [],
            parentTaskId: '',
            blockedBy: taskPlan.blockedBy || [],
            blocks: taskPlan.blocks || [],
            subtaskIds: [],
            decomposed: false,
            status: taskPlan.status || 'to-do',
            createdAt: taskNow,
            updatedAt: taskNow,
            createdBy: uid || '',
            createdByName: uname || '',
            history: {},
          };

          try {
            const taskId = await create('tasks', taskData);

            // Add creation history
            const historyRef = getDb().ref(`tasks/${taskId}/history`).push();
            await historyRef.set({
              id: historyRef.key,
              timestamp: taskNow,
              userId: uid || '',
              userName: uname || '',
              field: 'task',
              oldValue: null,
              newValue: taskPlan.title,
              action: 'create',
            });

            results.tasksCreated.push({
              id: taskId,
              title: taskPlan.title,
              sprintName: sprintPlan.name,
              devPoints,
              bizPoints,
              priority,
            });
            results.totalTasks++;
            results.totalDevPoints += devPoints;
          } catch (err) {
            results.errors.push(`Error creando tarea "${taskPlan.title}": ${err.message}`);
          }
        }
      }

      return {
        message: `Plan ejecutado: ${results.totalSprints} sprints y ${results.totalTasks} tareas creadas (${results.totalDevPoints} dev-points totales) en "${project.name}"`,
        ...results,
      };
    },
  },

  get_project_context: {
    description: 'Obtiene todo el contexto de un proyecto para toma de decisiones: tareas existentes, sprints, bugs, miembros y métricas. Útil antes de planificar nuevas funcionalidades.',
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

      const [tasks, sprints, bugs, proposals, users] = await Promise.all([
        getAll('tasks'),
        getAll('sprints'),
        getAll('bugs'),
        getAll('proposals'),
        getAll('users'),
      ]);

      const pt = tasks.filter(t => t.projectId === projectId);
      const ps = sprints.filter(s => s.projectId === projectId);
      const pb = bugs.filter(b => b.projectId === projectId);
      const pp = proposals.filter(p => p.projectId === projectId);

      return {
        project: {
          id: projectId,
          name: project.name,
          description: project.description,
          status: project.status,
          startDate: project.startDate,
          endDate: project.endDate,
          memberCount: project.members ? Object.keys(project.members).length : 0,
        },
        sprints: ps.map(s => ({
          id: s.id, name: s.name, status: s.status,
          startDate: s.startDate, endDate: s.endDate,
          taskCount: pt.filter(t => t.sprintId === s.id).length,
        })),
        tasksSummary: {
          total: pt.length,
          byStatus: {
            'to-do': pt.filter(t => t.status === 'to-do').length,
            'in-progress': pt.filter(t => t.status === 'in-progress').length,
            'to-validate': pt.filter(t => t.status === 'to-validate').length,
            'validated': pt.filter(t => t.status === 'validated').length,
            'done': pt.filter(t => t.status === 'done').length,
          },
          unassigned: pt.filter(t => !t.developer && t.status !== 'done').length,
          noSprint: pt.filter(t => !t.sprintId && t.status !== 'done').length,
          totalDevPoints: pt.reduce((s, t) => s + (t.devPoints || 0), 0),
        },
        bugsSummary: {
          total: pb.length,
          open: pb.filter(b => b.status !== 'closed').length,
          critical: pb.filter(b => b.severity === 'critical' && b.status !== 'closed').length,
        },
        pendingProposals: pp.filter(p => p.status === 'pending').length,
        recentTasks: pt
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .slice(0, 10)
          .map(t => ({ id: t.id, title: t.title, status: t.status, devPoints: t.devPoints })),
      };
    },
  },
};
