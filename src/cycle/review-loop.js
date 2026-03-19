import { runReviewer } from '../agents/reviewer.js';
import { runCoderFix } from '../agents/coder.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { remodulerState } from '../state/remoduler-state.js';

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

/**
 * Review loop: Reviewer ↔ Coder fix, max N ciclos.
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
  let totalTokens = { ...EMPTY_TOKENS };

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    logger.info(`Review cycle ${cycle}/${maxCycles}`, 'REVIEWER');
    eventBus.emit('review:cycle', { cycle, maxCycles });

    // --- REVIEW ---
    remodulerState.setCurrentAgent('REVIEWER');
    const depth = cycle === 1 ? reviewDepth : 'quick';

    const reviewResult = await runReviewer(task, prUrl, branchName, { depth });
    totalCost += reviewResult.cost || 0;
    totalTokens = addTokens(totalTokens, reviewResult.tokens || EMPTY_TOKENS);

    if (!reviewResult.success) {
      logger.error(`Reviewer failed: ${reviewResult.error}`, 'REVIEWER');
      return { approved: false, cycles: cycle, cost: totalCost, tokens: totalTokens, error: reviewResult.error };
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
        tokens: totalTokens,
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
        tokens: totalTokens,
        error: `Not approved after ${maxCycles} cycles`,
      };
    }

    // --- CODER FIX ---
    remodulerState.setCurrentAgent('CODER');
    logger.info(`Fixing ${reviewResult.issues.length} issues...`, 'CODER');

    const fixResult = await runCoderFix(task, branchName, reviewResult.issues);
    totalCost += fixResult.cost || 0;
    totalTokens = addTokens(totalTokens, fixResult.tokens || EMPTY_TOKENS);

    if (!fixResult.success) {
      logger.error(`Coder fix failed: ${fixResult.error}`, 'CODER');
      return { approved: false, cycles: cycle, cost: totalCost, tokens: totalTokens, error: fixResult.error };
    }

    logger.info(`Fixed: ${fixResult.issuesResolved.length} issues`, 'CODER');
  }
}
