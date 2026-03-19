import { getAll, getById, create, update, remove } from '../firebase.js';
import { config } from '../config.js';

const RULES_PATH = 'workflowRules';
const EXECUTIONS_PATH = 'workflowExecutions';

const TRIGGERS = ['task_status_change', 'task_created', 'task_assigned', 'bug_created', 'bug_status_change'];
const CONDITION_FIELDS = ['status', 'newStatus', 'oldStatus', 'developer', 'severity', 'priority', 'sprintId', 'bizPoints', 'devPoints'];
const CONDITION_OPERATORS = ['equals', 'not_equals', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'];
const ACTION_TYPES = ['change_status', 'assign_developer', 'send_notification', 'move_to_sprint'];

export const workflowTools = {
  list_workflow_rules: {
    description: 'Lista las reglas de automatización de un proyecto. Opcionalmente filtra por estado (enabled/disabled).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        enabled: { type: 'boolean', description: 'Filtrar solo reglas habilitadas (true) o deshabilitadas (false)' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, enabled }) => {
      let rules = await getAll(RULES_PATH);
      rules = rules.filter(r => r.projectId === projectId);
      if (enabled !== undefined) rules = rules.filter(r => r.enabled === enabled);
      return rules.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  create_workflow_rule: {
    description: 'Crea una regla de automatización para un proyecto. Define trigger, condiciones y acciones.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        name: { type: 'string', description: 'Nombre descriptivo de la regla' },
        description: { type: 'string', description: 'Descripción de qué hace la regla (opcional)' },
        trigger: { type: 'string', enum: TRIGGERS, description: 'Evento que dispara la regla' },
        conditions: {
          type: 'array',
          description: 'Condiciones que deben cumplirse',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: CONDITION_FIELDS, description: 'Campo a evaluar' },
              operator: { type: 'string', enum: CONDITION_OPERATORS, description: 'Operador de comparación' },
              value: { type: 'string', description: 'Valor a comparar' },
            },
            required: ['field', 'operator', 'value'],
          },
        },
        actions: {
          type: 'array',
          description: 'Acciones a ejecutar cuando se cumplan las condiciones',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ACTION_TYPES, description: 'Tipo de acción' },
              params: {
                type: 'object',
                description: 'Parámetros de la acción (ej: { "status": "done" } para change_status)',
              },
            },
            required: ['type', 'params'],
          },
        },
        enabled: { type: 'boolean', description: 'Si la regla está activa. Default: true' },
        userId: { type: 'string', description: 'UID del creador' },
      },
      required: ['projectId', 'name', 'trigger', 'conditions', 'actions'],
    },
    handler: async ({ projectId, name, description, trigger, conditions, actions, enabled, userId }) => {
      const project = await getById('projects', projectId);
      if (!project) return { error: `Proyecto ${projectId} no encontrado` };

      const uid = userId || config.defaultUserId;
      const now = Date.now();
      const ruleData = {
        projectId,
        name,
        description: description || '',
        trigger,
        conditions: conditions || [],
        actions: actions || [],
        enabled: enabled !== undefined ? enabled : true,
        createdAt: now,
        updatedAt: now,
        createdBy: uid || '',
      };

      const id = await create(RULES_PATH, ruleData);
      return { id, message: `Regla "${name}" creada en "${project.name}"`, rule: { id, ...ruleData } };
    },
  },

  update_workflow_rule: {
    description: 'Actualiza una regla de automatización existente.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'ID de la regla' },
        name: { type: 'string', description: 'Nuevo nombre' },
        description: { type: 'string', description: 'Nueva descripción' },
        trigger: { type: 'string', enum: TRIGGERS, description: 'Nuevo trigger' },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['field', 'operator', 'value'],
          },
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              params: { type: 'object' },
            },
            required: ['type', 'params'],
          },
        },
      },
      required: ['ruleId'],
    },
    handler: async ({ ruleId, name, description, trigger, conditions, actions }) => {
      const rule = await getById(RULES_PATH, ruleId);
      if (!rule) return { error: `Regla ${ruleId} no encontrada` };

      const updates = Object.fromEntries(
        Object.entries({ name, description, trigger, conditions, actions })
          .filter(([, v]) => v !== undefined)
      );
      updates.updatedAt = Date.now();

      await update(RULES_PATH, ruleId, updates);
      return { message: `Regla "${rule.name}" actualizada` };
    },
  },

  delete_workflow_rule: {
    description: 'Elimina una regla de automatización.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'ID de la regla a eliminar' },
      },
      required: ['ruleId'],
    },
    handler: async ({ ruleId }) => {
      const rule = await getById(RULES_PATH, ruleId);
      if (!rule) return { error: `Regla ${ruleId} no encontrada` };
      await remove(RULES_PATH, ruleId);
      return { message: `Regla "${rule.name}" eliminada` };
    },
  },

  toggle_workflow_rule: {
    description: 'Habilita o deshabilita una regla de automatización.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'ID de la regla' },
        enabled: { type: 'boolean', description: 'true para habilitar, false para deshabilitar' },
      },
      required: ['ruleId', 'enabled'],
    },
    handler: async ({ ruleId, enabled }) => {
      const rule = await getById(RULES_PATH, ruleId);
      if (!rule) return { error: `Regla ${ruleId} no encontrada` };
      await update(RULES_PATH, ruleId, { enabled, updatedAt: Date.now() });
      return { message: `Regla "${rule.name}" ${enabled ? 'habilitada' : 'deshabilitada'}` };
    },
  },

  list_workflow_executions: {
    description: 'Lista las ejecuciones recientes de reglas de automatización de un proyecto (log de auditoría).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      let executions = await getAll(EXECUTIONS_PATH);
      executions = executions.filter(e => e.projectId === projectId);
      return executions.sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0)).slice(0, 50);
    },
  },
};
