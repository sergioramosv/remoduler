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

/**
 * Pipeline completo de ejecución de una tarea.
 * Planner → Architect → Coder → QA/Tester/Security → Review Loop → Merge
 *
 * @param {string} projectId
 * @param {string} cwd - Directorio del repo target
 * @returns {{ success, taskId, totalCost, cycles } | null}
 */
export async function runTask(projectId, cwd) {
  let totalCost = 0;

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
    return null; // Backlog vacío
  }

  const task = planResult;
  totalCost += planResult.cost || 0;
  await budgetManager.addCost(planResult.cost || 0);

  remodulerState.setCurrentTask(task);
  logger.taskHeader(`TASK: ${task.title}`);

  eventBus.emit('task:start', {
    taskId: task.taskId,
    title: task.title,
    devPoints: task.devPoints,
  });

  try {
    // === PHASE 2: ARCHITECTING ===
    logger.taskHeader('PHASE 2: ARCHITECT');
    remodulerState.setCurrentAgent('ARCHITECT');

    const archResult = await runArchitect(task, task.repoUrl, { cwd });
    totalCost += archResult.cost || 0;
    await budgetManager.addCost(archResult.cost || 0);

    const plan = archResult.success ? archResult.plan : null;

    if (!plan) {
      logger.warn('Architect failed, Coder will work without plan');
    }

    // === PHASE 3: CODING ===
    logger.taskHeader('PHASE 3: CODING');
    remodulerState.setCurrentAgent('CODER');

    const codeResult = await runCoder(
      task,
      plan,
      task.branchName,
      task.repoUrl,
    );

    totalCost += codeResult.cost || 0;
    await budgetManager.addCost(codeResult.cost || 0);

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

    const testAgents = [];

    testAgents.push({
      name: 'QA',
      parallel: true,
      execute: () => runQA(task, branchName, filesChanged),
    });

    testAgents.push({
      name: 'TESTER',
      parallel: true,
      execute: () => runTester(
        task, branchName, plan, coderSummary, plan?.risks || [],
      ),
    });

    testAgents.push({
      name: 'SECURITY',
      parallel: true,
      execute: () => runSecurity(task, branchName, filesChanged),
    });

    const testResults = await runParallelAgents(testAgents);

    for (const [name, result] of Object.entries(testResults)) {
      totalCost += result.cost || 0;
      await budgetManager.addCost(result.cost || 0);
      if (result.success) {
        logger.success(`${name} done: ${result.summary || 'OK'}`, name);
      } else {
        logger.warn(`${name} failed: ${result.error || 'Unknown'}`, name);
      }
    }

    // Check if QA found coder bugs
    if (testResults.QA?.failsCoderCode) {
      logger.warn('QA found bugs in Coder code — review will flag these');
    }

    // Check security verdict
    if (testResults.SECURITY?.verdict === 'BLOCK') {
      logger.error('Security BLOCK: critical vulnerabilities found');
    }

    // === PHASE 5: REVIEW LOOP ===
    logger.taskHeader('PHASE 5: REVIEW');

    const reviewResult = await reviewLoop({
      prNumber,
      prUrl,
      task,
      branchName,
      maxCycles: config.maxReviewCycles,
    });

    totalCost += reviewResult.cost || 0;
    await budgetManager.addCost(reviewResult.cost || 0);

    // === RESULT ===
    if (reviewResult.approved) {
      logger.success(`Task completed! ${reviewResult.cycles} review cycle(s). Cost: $${totalCost.toFixed(4)}`);
      remodulerState.taskCompleted(totalCost);
      eventBus.emit('task:complete', { taskId: task.taskId, totalCost, cycles: reviewResult.cycles });
    } else {
      logger.error(`Task not approved after ${reviewResult.cycles} cycles`);
      remodulerState.taskFailed(reviewResult.error);
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
    remodulerState.taskFailed(error.message);
    eventBus.emit('task:failed', { taskId: task.taskId, error: error.message });
    return { success: false, taskId: task.taskId, totalCost, error: error.message };
  }
}
