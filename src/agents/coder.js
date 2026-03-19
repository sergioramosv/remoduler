import { BaseAgent } from './base-agent.js';
import { getCoderPrompt, getCoderFixPrompt } from '../prompts/coder.js';

/**
 * Ejecuta el agente Coder: implementa código, crea branch, abre PR.
 */
export async function runCoder(task, plan, branchName, repoUrl, options = {}) {
  const { cli = 'claude', timeout = 300000 } = options;

  const prompt = getCoderPrompt({ task, plan, branchName, repoUrl });

  const agent = new BaseAgent({
    name: 'CODER',
    cli,
    systemPrompt: prompt,
    mcpServers: ['github-mcp'],
    maxTurns: 30,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run('Implementa la tarea siguiendo el plan del Architect.');

  if (!result.success) return result;

  const data = result.data;
  if (!data || !data.branchName) {
    return { success: false, error: 'Coder did not return valid result', raw: result.result };
  }

  return {
    success: true,
    prNumber: data.prNumber,
    prUrl: data.prUrl,
    branchName: data.branchName,
    filesChanged: data.filesChanged || [],
    summary: data.summary,
    cost: result.cost,
    turns: result.turns,
    tokens: result.tokens,
    duration: result.duration,
  };
}

/**
 * Ejecuta el agente Coder en modo fix: corrige issues del Reviewer.
 */
export async function runCoderFix(task, branchName, reviewIssues, options = {}) {
  const { cli = 'claude', timeout = 180000 } = options;

  const prompt = getCoderFixPrompt({ task, branchName, reviewIssues });

  const agent = new BaseAgent({
    name: 'CODER',
    cli,
    systemPrompt: prompt,
    mcpServers: ['github-mcp'],
    maxTurns: 20,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run('Corrige los issues del Reviewer.');

  if (!result.success) return result;

  const data = result.data;
  if (!data) {
    return { success: false, error: 'CoderFix did not return valid result', raw: result.result };
  }

  return {
    success: true,
    fixed: data.fixed ?? false,
    issuesResolved: data.issuesResolved || [],
    issuesNotResolved: data.issuesNotResolved || [],
    filesChanged: data.filesChanged || [],
    summary: data.summary,
    cost: result.cost,
    turns: result.turns,
    tokens: result.tokens,
    duration: result.duration,
  };
}
