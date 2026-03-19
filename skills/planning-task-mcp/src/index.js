#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { validateConfig } from './config.js';
import { projectTools } from './tools/projects.js';
import { sprintTools } from './tools/sprints.js';
import { taskTools } from './tools/tasks.js';
import { bugTools } from './tools/bugs.js';
import { proposalTools } from './tools/proposals.js';
import { commentTools } from './tools/comments.js';
import { notificationTools } from './tools/notifications.js';
import { memberTools } from './tools/members.js';
import { invitationTools } from './tools/invitations.js';
import { userTools } from './tools/users.js';
import { analyticsTools } from './tools/analytics.js';
import { plannerTools } from './tools/planner.js';
import { komodoTools } from './tools/komodo.js';
import { epicTools } from './tools/epics.js';
import { achievementTools } from './tools/achievements.js';
import { taskTemplateTools } from './tools/taskTemplates.js';
import { retrospectiveTools } from './tools/retrospectives.js';
import { standupTools } from './tools/standup.js';
import { workflowTools } from './tools/workflows.js';
import { timeTrackingTools } from './tools/timeTracking.js';
import { savedViewTools } from './tools/savedViews.js';

// Validate configuration before starting
const errors = validateConfig();
if (errors.length > 0) {
  console.error('Planning MCP - Errores de configuración:');
  errors.forEach(e => console.error(`  - ${e}`));
  console.error('\nEjecuta: planning-task-mcp-setup (o npm run setup)');
  process.exit(1);
}

const server = new McpServer({
  name: 'planning-task-mcp',
  version: '1.0.0',
  description: 'MCP Server para gestión completa de proyectos Planning Task. Permite crear proyectos, sprints, tareas con User Stories, gestionar bugs, propuestas, miembros, y planificar automáticamente desde documentos en lenguaje natural.',
});

// Merge all tool groups
const allTools = {
  ...projectTools,
  ...sprintTools,
  ...taskTools,
  ...bugTools,
  ...proposalTools,
  ...commentTools,
  ...notificationTools,
  ...memberTools,
  ...invitationTools,
  ...userTools,
  ...analyticsTools,
  ...plannerTools,
  ...komodoTools,
  ...epicTools,
  ...achievementTools,
  ...taskTemplateTools,
  ...retrospectiveTools,
  ...standupTools,
  ...workflowTools,
  ...timeTrackingTools,
  ...savedViewTools,
};

// Convert JSON Schema properties to Zod schemas
function jsonPropsToZod(properties, required = []) {
  const shape = {};

  for (const [key, prop] of Object.entries(properties || {})) {
    let zodType;

    if (prop.type === 'string') {
      zodType = z.string();
      if (prop.enum) zodType = z.enum(prop.enum);
    } else if (prop.type === 'number') {
      zodType = z.number();
      if (prop.enum) zodType = z.number().refine(v => prop.enum.includes(v));
    } else if (prop.type === 'boolean') {
      zodType = z.boolean();
    } else if (prop.type === 'array') {
      if (prop.items?.type === 'string') {
        zodType = z.array(z.string());
      } else if (prop.items?.type === 'object') {
        zodType = z.array(z.object(jsonPropsToZod(prop.items.properties, prop.items.required)));
      } else {
        zodType = z.array(z.any());
      }
    } else if (prop.type === 'object') {
      if (prop.properties) {
        zodType = z.object(jsonPropsToZod(prop.properties, prop.required));
      } else {
        zodType = z.record(z.any());
      }
    } else {
      zodType = z.any();
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    shape[key] = zodType;
  }

  return shape;
}

// Register all tools
for (const [name, tool] of Object.entries(allTools)) {
  const zodShape = jsonPropsToZod(
    tool.inputSchema?.properties,
    tool.inputSchema?.required
  );

  server.tool(name, tool.description, zodShape, async (params) => {
    try {
      const result = await tool.handler(params);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message, stack: err.stack }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
