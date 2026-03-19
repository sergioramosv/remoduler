import { BaseAgent } from './base-agent.js';
import { getPlannerPrompt } from '../prompts/planner.js';
import { getFocus, clearFocus, parseTaskPhase } from '../state/focus.js';
import { logger } from '../utils/logger.js';

/**
 * Ejecuta el agente Planner: consulta el MCP, selecciona tarea, la marca in-progress.
 * Si hay focus activo, solo elige tareas de esa fase en orden numérico.
 */
export async function runPlanner({ projectId, userId, userName }, options = {}) {
  const { cli = 'claude', timeout = 180000 } = options;

  // Check focus
  const focus = await getFocus();
  if (focus?.phase) {
    logger.info(`Focus mode: phase ${focus.phase}`, 'PLANNER');
  }

  const prompt = getPlannerPrompt({
    projectId,
    userId,
    userName,
    focus: focus?.phase || null,
  });

  const agent = new BaseAgent({
    name: 'PLANNER',
    cli,
    systemPrompt: prompt,
    mcpServers: ['planning-task-mcp'],
    maxTurns: 15,
    timeout,
    parseAsJson: true,
  });

  const userMsg = focus?.phase
    ? `Selecciona la siguiente tarea de la fase ${focus.phase}. Solo tareas [${focus.phase}.X], en orden numérico.`
    : 'Selecciona la siguiente tarea a implementar.';

  const result = await agent.run(userMsg);

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

  // Si no hay tareas y estábamos en focus, limpiar el focus
  if (data.taskId === null) {
    if (focus?.phase) {
      await clearFocus();
      logger.success(`Phase ${focus.phase} complete! Focus cleared.`, 'PLANNER');
    }
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
