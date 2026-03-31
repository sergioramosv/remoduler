import { logger } from '../utils/logger.js';

/**
 * ExplainDecision — provides human-readable explanations for Remoduler decisions.
 */

/**
 * Explains why a task was selected for execution.
 * @param {{ id: string, title: string, priority: number, status: string }} task
 * @param {{ strategy: string, candidates: number }} context
 * @returns {string}
 */
export function explainTaskSelection(task, context) {
  const reason = `Task selected: "${task.title}" (priority ${task.priority}, status: ${task.status}). Strategy: ${context.strategy}. Candidates evaluated: ${context.candidates}.`;
  logger.info(reason, 'EXPLAIN');
  return reason;
}

/**
 * Explains why a PR was rejected.
 * @param {{ issues: string[], reviewScore: number, cycles: number, maxCycles: number }} context
 * @returns {string}
 */
export function explainPrRejection(context) {
  const issuesSummary = context.issues?.slice(0, 3).join('; ') || 'unspecified issues';
  const reason = `PR rejected after ${context.cycles}/${context.maxCycles} review cycles. Score: ${context.reviewScore?.toFixed(2) ?? 'N/A'}. Issues: ${issuesSummary}${context.issues?.length > 3 ? ` (+${context.issues.length - 3} more)` : ''}.`;
  logger.warn(reason, 'EXPLAIN');
  return reason;
}

/**
 * Explains why a specific model was selected for a task.
 * @param {{ model: string, reason: string, taskComplexity: string, estimatedTokens: number }} context
 * @returns {string}
 */
export function explainModelSelection(context) {
  const reason = `Model selected: ${context.model}. Complexity: ${context.taskComplexity}. Estimated tokens: ${context.estimatedTokens?.toLocaleString() ?? 'unknown'}. Reason: ${context.reason}.`;
  logger.info(reason, 'EXPLAIN');
  return reason;
}
