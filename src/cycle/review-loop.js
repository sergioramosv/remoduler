import { runReviewer } from '../agents/reviewer.js';
import { runCoderFix } from '../agents/coder.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { remodulerState } from '../state/remoduler-state.js';

/**
 * Review loop: Reviewer ↔ Coder fix, max N ciclos.
 *
 * @param {object} options
 * @param {number} options.prNumber
 * @param {string} options.prUrl
 * @param {object} options.task - Task spec del planner
 * @param {string} options.branchName
 * @param {number} options.maxCycles - Max review cycles (default 3)
 * @param {string} options.reviewDepth - quick|standard|deep|forensic
 * @returns {{ approved, cycles, finalReview, cost }}
 */
export async function reviewLoop(options) {
  const {
    prNumber,
    prUrl,
    task,
    branchName,
    maxCycles = 3,
    reviewDepth = 'standard',
  } = options;

  let totalCost = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    logger.info(`Review cycle ${cycle}/${maxCycles}`, 'REVIEWER');
    eventBus.emit('review:cycle', { cycle, maxCycles });

    // --- REVIEW ---
    remodulerState.setCurrentAgent('REVIEWER');
    const depth = cycle === 1 ? reviewDepth : 'quick'; // Ciclos 2+ son quick

    const reviewResult = await runReviewer(task, prUrl, branchName, { depth });
    totalCost += reviewResult.cost || 0;

    if (!reviewResult.success) {
      logger.error(`Reviewer failed: ${reviewResult.error}`, 'REVIEWER');
      return { approved: false, cycles: cycle, cost: totalCost, error: reviewResult.error };
    }

    // --- VERDICT CHECK ---
    if (reviewResult.verdict === 'APPROVED') {
      logger.success(`PR approved! Score: ${reviewResult.score}`, 'REVIEWER');
      eventBus.emit('review:approved', { cycle, score: reviewResult.score });
      return {
        approved: true,
        cycles: cycle,
        finalReview: reviewResult,
        cost: totalCost,
      };
    }

    logger.warn(`REQUEST_CHANGES (score: ${reviewResult.score}, ${reviewResult.issues.length} issues)`, 'REVIEWER');
    eventBus.emit('review:changes', { cycle, score: reviewResult.score, issues: reviewResult.issues.length });

    // Last cycle? Give up
    if (cycle === maxCycles) {
      logger.error(`Not approved after ${maxCycles} cycles`, 'REVIEWER');
      return {
        approved: false,
        cycles: cycle,
        finalReview: reviewResult,
        cost: totalCost,
        error: `Not approved after ${maxCycles} cycles`,
      };
    }

    // --- CODER FIX ---
    remodulerState.setCurrentAgent('CODER');
    logger.info(`Fixing ${reviewResult.issues.length} issues...`, 'CODER');

    const fixResult = await runCoderFix(task, branchName, reviewResult.issues);
    totalCost += fixResult.cost || 0;

    if (!fixResult.success) {
      logger.error(`Coder fix failed: ${fixResult.error}`, 'CODER');
      return { approved: false, cycles: cycle, cost: totalCost, error: fixResult.error };
    }

    logger.info(`Fixed: ${fixResult.issuesResolved.length} issues`, 'CODER');
  }
}
