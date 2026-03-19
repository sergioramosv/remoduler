import { BaseAgent } from './base-agent.js';
import { getReviewerPrompt } from '../prompts/reviewer.js';

/**
 * Ejecuta el agente Reviewer: revisa un PR con criterios estrictos.
 */
export async function runReviewer(task, prUrl, branchName, options = {}) {
  const { cli = 'claude', timeout = 120000, depth = 'standard' } = options;

  const prompt = getReviewerPrompt({ task, prUrl, branchName, depth });

  const agent = new BaseAgent({
    name: 'REVIEWER',
    cli,
    systemPrompt: prompt,
    mcpServers: ['github-mcp'],
    maxTurns: 15,
    timeout,
    reviewerMode: true,
    parseAsJson: true,
  });

  const result = await agent.run('Revisa el PR y da tu veredicto.');

  if (!result.success) return result;

  const data = result.data;
  if (!data || !data.verdict) {
    return { success: false, error: 'Reviewer did not return valid verdict', raw: result.result };
  }

  return {
    success: true,
    verdict: data.verdict,
    score: data.score,
    issues: data.issues || [],
    positives: data.positives || [],
    summary: data.summary,
    cost: result.cost,
    turns: result.turns,
    duration: result.duration,
  };
}
