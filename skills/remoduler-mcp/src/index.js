#!/usr/bin/env node

/**
 * Remoduler MCP Server
 *
 * Expone el orquestador Remoduler como servidor MCP.
 * Permite a Claude Code u otros clientes MCP ejecutar agentes paso a paso o en ciclo completo.
 *
 * Tools:
 *   remoduler_plan     → Planner elige tarea
 *   remoduler_code     → Architect + Coder implementa
 *   remoduler_review   → Reviewer revisa PR
 *   remoduler_fix      → Coder arregla issues
 *   remoduler_finalize → Merge/close PR + actualizar tarea
 *   remoduler_run      → Ciclo completo de N tareas
 *   remoduler_resume   → Reanudar desde checkpoint
 *   remoduler_status   → Config actual + budget
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.REMODULER_ROOT || resolve(__dirname, '..', '..', '..');

dotenv.config({ path: resolve(ROOT_DIR, '.env'), quiet: true });

const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { tools } = await import('./tools.js');

const server = new McpServer({
  name: 'remoduler-mcp',
  version: '1.0.0',
  description: 'Orquestador Remoduler: coordina agentes IA (Planner, Architect, Coder, Reviewer, QA, Tester, Security) para desarrollo autónomo.',
});

for (const [name, tool] of Object.entries(tools)) {
  server.tool(name, tool.description, tool.schema, async (params) => {
    try {
      const result = await tool.handler(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }],
        isError: true,
      };
    }
  });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
