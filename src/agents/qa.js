import { BaseAgent } from './base-agent.js';
import { getQAPrompt } from '../prompts/qa.js';

/**
 * Ejecuta el agente QA: genera y ejecuta tests de aceptación.
 */
export async function runQA(task, branchName, filesChanged, options = {}) {
  const { cli = 'claude', timeout = 180000 } = options;

  const prompt = getQAPrompt({ task, branchName, filesChanged });

  const agent = new BaseAgent({
    name: 'QA',
    cli,
    systemPrompt: prompt,
    mcpServers: [],
    maxTurns: 20,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run('Genera y ejecuta tests para los criterios de aceptación.');

  if (!result.success) return result;

  const data = result.data;
  if (!data || data.testsGenerated === undefined) {
    return { success: false, error: 'QA did not return valid result', raw: result.result };
  }

  return {
    success: true,
    testsGenerated: data.testsGenerated,
    testsPassed: data.testsPassed,
    testsFailed: data.testsFailed,
    filesCreated: data.filesCreated || [],
    pushed: data.pushed ?? false,
    failsCoderCode: data.failsCoderCode ?? false,
    failedTests: data.failedTests || [],
    summary: data.summary,
    cost: result.cost,
    turns: result.turns,
    tokens: result.tokens,
    duration: result.duration,
  };
}
