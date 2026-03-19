import { BaseAgent } from './base-agent.js';
import { getTesterPrompt } from '../prompts/tester.js';

/**
 * Ejecuta el agente Tester: tests quirúrgicos con contexto del Architect/Coder.
 */
export async function runTester(task, branchName, plan, coderSummary, risks, options = {}) {
  const { cli = 'claude', timeout = 180000 } = options;

  const prompt = getTesterPrompt({ task, branchName, plan, coderSummary, risks });

  const agent = new BaseAgent({
    name: 'TESTER',
    cli,
    systemPrompt: prompt,
    mcpServers: [],
    maxTurns: 20,
    timeout,
    parseAsJson: true,
  });

  const result = await agent.run('Genera y ejecuta tests quirúrgicos basados en el contexto.');

  if (!result.success) return result;

  const data = result.data;
  if (!data || data.testsGenerated === undefined) {
    return { success: false, error: 'Tester did not return valid result', raw: result.result };
  }

  return {
    success: true,
    testsGenerated: data.testsGenerated,
    testsPassed: data.testsPassed,
    testsFailed: data.testsFailed,
    coverage: data.coverage,
    filesCreated: data.filesCreated || [],
    pushed: data.pushed ?? false,
    failsCoderCode: data.failsCoderCode ?? false,
    failedTests: data.failedTests || [],
    summary: data.summary,
    cost: result.cost,
    turns: result.turns,
    duration: result.duration,
  };
}
