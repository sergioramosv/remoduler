import { BaseAgent } from './base-agent.js';
import { getArchitectPrompt } from '../prompts/architect.js';

/**
 * Ejecuta el agente Architect: analiza codebase y genera plan de implementación.
 * @param {object} task - Tarea del planner (taskId, title, description, userStory, acceptanceCriteria, devPoints)
 * @param {string} repoUrl - URL del repositorio
 * @param {object} options - { cli, timeout, cwd }
 */
export async function runArchitect(task, repoUrl, options = {}) {
  const { cli = 'claude', timeout = 120000, cwd } = options;

  const prompt = getArchitectPrompt({ task, repoUrl });

  const agent = new BaseAgent({
    name: 'ARCHITECT',
    cli,
    systemPrompt: prompt,
    mcpServers: [], // Architect solo lee archivos, no necesita MCPs
    maxTurns: 15,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run(
    cwd ? `El repositorio está en: ${cwd}\n\nAnaliza el codebase y genera el plan.` : 'Analiza el codebase y genera el plan de implementación.'
  );

  if (!result.success) return result;

  const data = result.data;
  if (!data || !data.implementationOrder) {
    return { success: false, error: 'Architect did not return valid plan', raw: result.result };
  }

  return {
    success: true,
    plan: data,
    cost: result.cost,
    turns: result.turns,
    duration: result.duration,
  };
}
