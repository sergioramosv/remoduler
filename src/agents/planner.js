import { BaseAgent } from './base-agent.js';
import { getPlannerPrompt } from '../prompts/planner.js';

/**
 * Ejecuta el agente Planner: consulta el MCP, selecciona tarea, la marca in-progress.
 */
export async function runPlanner({ projectId, userId, userName }, options = {}) {
  const { cli = 'claude', timeout = 180000 } = options;

  const prompt = getPlannerPrompt({ projectId, userId, userName });

  const agent = new BaseAgent({
    name: 'PLANNER',
    cli,
    systemPrompt: prompt,
    mcpServers: ['planning-task-mcp'],
    maxTurns: 15,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run('Selecciona la siguiente tarea a implementar.');

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      rateLimited: result.rateLimited ?? false,
      earlyTerminated: result.earlyTerminated ?? false,
    };
  }

  const data = result.data;

  if (!data) {
    return { success: false, error: 'No structured data in response', raw: result.result };
  }

  // Caso: no hay tareas
  if (data.taskId === null) {
    return { success: true, empty: true, message: data.message };
  }

  return {
    success: true,
    taskId: data.taskId,
    title: data.title,
    description: data.description,
    userStory: data.userStory,
    acceptanceCriteria: data.acceptanceCriteria,
    branchName: data.branchName,
    repoUrl: data.repoUrl,
    sprintId: data.sprintId,
    devPoints: data.devPoints,
    reason: data.reason,
    cost: result.cost,
    turns: result.turns,
    tokens: result.tokens,
    duration: result.duration,
  };
}
