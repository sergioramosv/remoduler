import { runTask } from './cycle/task-runner.js';
import { logger } from './utils/logger.js';
import { eventBus } from './events/event-bus.js';
import { remodulerState } from './state/remoduler-state.js';
import { checkpointManager } from './state/checkpoint-manager.js';
import { config } from './config.js';
import { budgetManager } from './cost/budget-manager.js';

export { eventBus, remodulerState, checkpointManager };

/**
 * Ejecuta N tareas del backlog secuencialmente.
 */
export async function run(projectId, options = {}) {
  const { tasks: maxTasks = 1, cwd = process.cwd(), dryRun = false } = options;

  logger.taskHeader(`REMODULER — ${dryRun ? 'DRY RUN' : 'RUNNING'}`);
  logger.info(`Project: ${projectId} | Tasks: ${maxTasks || '∞'} | CWD: ${cwd}`);

  remodulerState.setExecution('running');
  await budgetManager.initialize(projectId);
  eventBus.emit('orchestrator:start', { projectId, maxTasks });

  const startTime = Date.now();
  let completed = 0;
  let failed = 0;

  try {
    const limit = maxTasks || Infinity;

    for (let i = 0; i < limit; i++) {
      // Check pause/stop
      if (remodulerState.isPauseRequested()) {
        logger.warn('Pause requested, stopping after current iteration');
        break;
      }
      if (remodulerState.isStopRequested()) {
        logger.warn('Stop requested');
        break;
      }

      // Check budget
      if (budgetManager.isExceeded()) {
        const status = budgetManager.getStatus();
        logger.warn(`Budget exceeded — Daily: $${status.daily.spent.toFixed(2)}/$${status.daily.limit} | Weekly: $${status.weekly.spent.toFixed(2)}/$${status.weekly.limit}`);
        break;
      }

      // Execute task
      logger.taskHeader(`TASK ${i + 1}/${maxTasks || '∞'}`);

      const result = await runTask(projectId, cwd);

      if (!result) {
        logger.info('Backlog empty, no more tasks');
        break;
      }

      if (result.rateLimited) {
        logger.warn('Rate limited, stopping');
        break;
      }

      if (result.success) {
        completed++;
        const eur = (result.totalCost * 0.92).toFixed(4);
        logger.success(`Task completed (${completed} done, ${eur}€ / $${result.totalCost?.toFixed(4)})`);
      } else {
        failed++;
        logger.error(`Task failed: ${result.error || 'unknown'}`);
        // Graceful degradation: continue with next task
      }
    }
  } finally {
    remodulerState.setExecution('idle');

    const duration = Date.now() - startTime;
    const totalCost = remodulerState.state.totalCost;

    const budgetStatus = budgetManager.getStatus();
    const costEur = (totalCost * 0.92).toFixed(4);

    logger.taskHeader('REMODULER — DONE');
    logger.info(`Completed: ${completed} | Failed: ${failed}`);
    logger.info(`Cost: ${costEur}€ / $${totalCost.toFixed(4)}`);
    logger.info(`Tokens: ${budgetStatus.tokens.total.toLocaleString()} (in: ${budgetStatus.tokens.input.toLocaleString()} | out: ${budgetStatus.tokens.output.toLocaleString()} | cache-r: ${budgetStatus.tokens.cacheRead.toLocaleString()} | cache-w: ${budgetStatus.tokens.cacheWrite.toLocaleString()})`);
    logger.info(`Time: ${(duration / 1000).toFixed(0)}s`);

    eventBus.emit('orchestrator:done', { completed, failed, totalCost, tokens: budgetStatus.tokens, duration });
  }

  return { completed, failed, totalCost: remodulerState.state.totalCost };
}

/**
 * Reanuda desde el último checkpoint.
 */
export async function resume(options = {}) {
  const { cwd = process.cwd() } = options;

  const checkpoint = await checkpointManager.getLatest();

  if (!checkpoint) {
    logger.info('No checkpoints found');
    return null;
  }

  if (!checkpointManager.isValid(checkpoint)) {
    logger.warn('Checkpoint expired (>24h), removing');
    await checkpointManager.remove(checkpoint);
    return null;
  }

  logger.info(`Resuming task: ${checkpoint.task?.title || checkpoint.taskId}`);
  logger.info(`Phase: ${checkpoint.phase}`);

  // Re-run the task from the beginning (simplified resume)
  const result = await runTask(checkpoint.task?.projectId || config.defaultProjectId, cwd);

  await checkpointManager.remove(checkpoint);
  return result;
}

/**
 * Detecta checkpoints pendientes.
 */
export async function checkForPendingCheckpoints() {
  const checkpoint = await checkpointManager.getLatest();

  if (!checkpoint) return false;

  if (!checkpointManager.isValid(checkpoint)) {
    await checkpointManager.remove(checkpoint);
    return false;
  }

  logger.warn(`Pending checkpoint found: ${checkpoint.task?.title || checkpoint.taskId}`);
  logger.info('Run "remoduler resume" to continue');
  return true;
}
