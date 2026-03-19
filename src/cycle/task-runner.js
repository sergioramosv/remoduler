import { runPlanner } from '../agents/planner.js';
import { runArchitect } from '../agents/architect.js';
import { runCoder } from '../agents/coder.js';
import { runQA } from '../agents/qa.js';
import { runTester } from '../agents/tester.js';
import { runSecurity } from '../agents/security-agent.js';
import { reviewLoop } from './review-loop.js';
import { runParallelAgents } from './pipeline-scheduler.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { remodulerState } from '../state/remoduler-state.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { config } from '../config.js';
import { budgetManager } from '../cost/budget-manager.js';
import { changeTaskStatus } from '../firebase.js';
import { classifyComplexity } from '../triage/complexity-classifier.js';
import { selectModel } from '../triage/model-selector.js';
import { shouldDecompose } from '../triage/task-decomposer.js';

const EMPTY_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function addTokens(a, b) {
  return {
    input: (a.input || 0) + (b.input || 0),
    output: (a.output || 0) + (b.output || 0),
    cacheRead: (a.cacheRead || 0) + (b.cacheRead || 0),
    cacheWrite: (a.cacheWrite || 0) + (b.cacheWrite || 0),
    total: (a.total || 0) + (b.total || 0),
  };
}

function trackAgent(stats, name, result) {
  stats[name] = {
    cost: result.cost || 0,
    tokens: result.tokens || { ...EMPTY_TOKENS },
    turns: result.turns || 0,
    duration: result.duration || 0,
  };
}

function printSummary(stats) {
  logger.taskHeader('TASK SUMMARY — Per Agent');

  let totalCost = 0;
  let totalTokens = { ...EMPTY_TOKENS };

  let totalDuration = 0;
  const rows = [];
  for (const [name, s] of Object.entries(stats)) {
    totalCost += s.cost;
    totalTokens = addTokens(totalTokens, s.tokens);
    totalDuration += s.duration;
    rows.push({
      name,
      eur: (s.cost * 0.92).toFixed(3),
      usd: s.cost.toFixed(3),
      tokens: s.tokens.total,
      turns: s.turns,
      time: fmtDuration(s.duration),
    });
  }

  // Print table
  const nameW = 12;
  const header = `${'Agent'.padEnd(nameW)} ${'EUR'.padStart(8)} ${'USD'.padStart(8)} ${'Tokens'.padStart(10)} ${'Turns'.padStart(6)} ${'Time'.padStart(8)}`;
  console.log(`  ${header}`);
  console.log(`  ${'─'.repeat(header.length)}`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(nameW)} ${(r.eur + '€').padStart(8)} ${('$' + r.usd).padStart(8)} ${r.tokens.toLocaleString().padStart(10)} ${String(r.turns).padStart(6)} ${r.time.padStart(8)}`);
  }
  console.log(`  ${'─'.repeat(header.length)}`);
  console.log(`  ${'TOTAL'.padEnd(nameW)} ${((totalCost * 0.92).toFixed(3) + '€').padStart(8)} ${('$' + totalCost.toFixed(3)).padStart(8)} ${totalTokens.total.toLocaleString().padStart(10)} ${''.padStart(6)} ${fmtDuration(totalDuration).padStart(8)}`);
  console.log(`\n  Tokens breakdown: in: ${totalTokens.input.toLocaleString()} | out: ${totalTokens.output.toLocaleString()} | cache-r: ${totalTokens.cacheRead.toLocaleString()} | cache-w: ${totalTokens.cacheWrite.toLocaleString()}\n`);
}

function fmtDuration(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Pipeline completo de ejecución de una tarea.
 */
export async function runTask(projectId, cwd) {
  let totalCost = 0;
  const agentStats = {};

  // === PHASE 1: PLANNING ===
  logger.taskHeader('PHASE 1: PLANNING');
  remodulerState.setCurrentAgent('PLANNER');

  const planResult = await runPlanner({
    projectId,
    userId: config.defaultUserId,
    userName: config.defaultUserName || 'Remoduler',
  });

  if (!planResult.success) {
    if (planResult.rateLimited) {
      logger.warn('Planner rate limited');
      return { rateLimited: true };
    }
    logger.error(`Planner failed: ${planResult.error}`);
    return null;
  }

  if (planResult.empty) {
    logger.info(planResult.message);
    return null;
  }

  const task = planResult;
  totalCost += planResult.cost || 0;
  await budgetManager.addCost(planResult.cost || 0, planResult.tokens);
  trackAgent(agentStats, 'PLANNER', planResult);

  remodulerState.setCurrentTask(task);
  logger.taskHeader(`TASK: ${task.title}`);

  eventBus.emit('task:start', {
    taskId: task.taskId,
    title: task.title,
    devPoints: task.devPoints,
  });

  // === TRIAGE: Complexity Classification ===
  const complexity = classifyComplexity(task);
  logger.info(`Complexity: ${complexity.level} (score: ${complexity.score}) — ${complexity.reasons.join('; ')}`, 'TRIAGE');

  const coderModel = selectModel('CODER', complexity.level);
  logger.info(`Model selection — CODER: ${coderModel}`, 'TRIAGE');

  if (shouldDecompose(task)) {
    logger.warn(`Task devPoints (${task.devPoints}) exceeds decomposition threshold — consider splitting`, 'TRIAGE');
  }

  try {
    // === PHASE 2: ARCHITECTING ===
    logger.taskHeader('PHASE 2: ARCHITECT');
    remodulerState.setCurrentAgent('ARCHITECT');

    const archResult = await runArchitect(task, task.repoUrl, { cwd });
    totalCost += archResult.cost || 0;
    await budgetManager.addCost(archResult.cost || 0, archResult.tokens);
    trackAgent(agentStats, 'ARCHITECT', archResult);

    const plan = archResult.success ? archResult.plan : null;

    if (!plan) {
      logger.warn('Architect failed, Coder will work without plan');
    }

    // === PHASE 3: CODING ===
    logger.taskHeader('PHASE 3: CODING');
    remodulerState.setCurrentAgent('CODER');

    const codeResult = await runCoder(task, plan, task.branchName, task.repoUrl);
    totalCost += codeResult.cost || 0;
    await budgetManager.addCost(codeResult.cost || 0, codeResult.tokens);
    trackAgent(agentStats, 'CODER', codeResult);

    if (!codeResult.success) {
      if (codeResult.rateLimited) {
        await checkpointManager.save({ taskId: task.taskId, phase: 'code', task, plan, cwd });
        logger.warn('Coder rate limited, checkpoint saved');
        return { rateLimited: true, totalCost };
      }
      throw new Error(`Coder failed: ${codeResult.error}`);
    }

    const { prUrl, prNumber, branchName, filesChanged, summary: coderSummary } = codeResult;
    logger.success(`PR created: ${prUrl}`, 'CODER');
    eventBus.emit('task:prCreated', { taskId: task.taskId, prNumber, prUrl });

    // === PHASE 4: TESTING (parallel) ===
    logger.taskHeader('PHASE 4: TESTING');

    const testAgents = [
      { name: 'QA', parallel: true, execute: () => runQA(task, branchName, filesChanged) },
      { name: 'TESTER', parallel: true, execute: () => runTester(task, branchName, plan, coderSummary, plan?.risks || []) },
      { name: 'SECURITY', parallel: true, execute: () => runSecurity(task, branchName, filesChanged) },
    ];

    const testResults = await runParallelAgents(testAgents);

    for (const [name, result] of Object.entries(testResults)) {
      totalCost += result.cost || 0;
      await budgetManager.addCost(result.cost || 0, result.tokens);
      trackAgent(agentStats, name, result);
      if (result.success) {
        logger.success(`${name} done: ${result.summary || 'OK'}`, name);
      } else {
        logger.warn(`${name} failed: ${result.error || 'Unknown'}`, name);
      }
    }

    if (testResults.QA?.failsCoderCode) {
      logger.warn('QA found bugs in Coder code — review will flag these');
    }
    if (testResults.SECURITY?.verdict === 'BLOCK') {
      logger.error('Security BLOCK: critical vulnerabilities found');
    }

    // === PHASE 5: REVIEW LOOP ===
    logger.taskHeader('PHASE 5: REVIEW');

    const reviewResult = await reviewLoop({
      prNumber, prUrl, task, branchName,
      maxCycles: config.maxReviewCycles,
    });

    totalCost += reviewResult.cost || 0;
    await budgetManager.addCost(reviewResult.cost || 0, reviewResult.tokens);
    trackAgent(agentStats, 'REVIEWER', { cost: reviewResult.cost, tokens: reviewResult.tokens, turns: 0, duration: 0 });

    // === SUMMARY ===
    printSummary(agentStats);

    // === RESULT ===
    if (reviewResult.approved) {
      logger.success(`Task completed! ${reviewResult.cycles} review cycle(s).`);
      remodulerState.taskCompleted(totalCost);

      try {
        await changeTaskStatus(task.taskId, 'to-validate');
        logger.info(`Task ${task.taskId} → to-validate`, 'PLANNER');
      } catch (err) {
        logger.warn(`Failed to update task status: ${err.message}`, 'PLANNER');
      }

      eventBus.emit('task:complete', { taskId: task.taskId, totalCost, cycles: reviewResult.cycles });
    } else {
      logger.error(`Task not approved after ${reviewResult.cycles} cycles`);
      remodulerState.taskFailed(reviewResult.error);

      try {
        await changeTaskStatus(task.taskId, 'to-do');
        logger.info(`Task ${task.taskId} → to-do (not approved)`, 'PLANNER');
      } catch (err) {
        logger.warn(`Failed to update task status: ${err.message}`, 'PLANNER');
      }

      eventBus.emit('task:failed', { taskId: task.taskId, error: reviewResult.error });
    }

    return {
      success: reviewResult.approved,
      taskId: task.taskId,
      totalCost,
      cycles: reviewResult.cycles,
    };

  } catch (error) {
    logger.error(`Task failed: ${error.message}`);
    printSummary(agentStats);
    remodulerState.taskFailed(error.message);
    eventBus.emit('task:failed', { taskId: task.taskId, error: error.message });
    return { success: false, taskId: task.taskId, totalCost, error: error.message };
  }
}
