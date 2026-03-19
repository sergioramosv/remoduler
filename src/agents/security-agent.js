import { BaseAgent } from './base-agent.js';
import { getSecurityPrompt } from '../prompts/security.js';

/**
 * Ejecuta el agente Security: escanea código buscando vulnerabilidades OWASP.
 */
export async function runSecurity(task, branchName, filesChanged, options = {}) {
  const { cli = 'claude', timeout = 120000 } = options;

  const prompt = getSecurityPrompt({ task, branchName, filesChanged });

  const agent = new BaseAgent({
    name: 'SECURITY',
    cli,
    systemPrompt: prompt,
    mcpServers: [],
    maxTurns: 10,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run('Escanea el código del PR buscando vulnerabilidades.');

  if (!result.success) return result;

  const data = result.data;
  if (!data || !data.verdict) {
    return { success: false, error: 'Security did not return valid result', raw: result.result };
  }

  return {
    success: true,
    verdict: data.verdict,
    findings: data.findings || [],
    summary: data.summary,
    cost: result.cost,
    turns: result.turns,
    duration: result.duration,
  };
}
