/**
 * Task Decomposer — splits large tasks into smaller subtasks.
 */

import { config } from '../config.js';

export const DECOMPOSE_THRESHOLD = config.triageDecomposeThreshold ?? 5;

/**
 * Determines if a task should be decomposed based on devPoints.
 * @param {{ devPoints?: number }} taskSpec
 * @returns {boolean}
 */
export function shouldDecompose(taskSpec) {
  return (taskSpec.devPoints || 0) > DECOMPOSE_THRESHOLD;
}

/**
 * Decomposes a large task into subtasks based on acceptance criteria.
 * Each criterion becomes a subtask with proportionally distributed devPoints.
 * @param {{ id?: string, title?: string, description?: string, acceptanceCriteria?: string[], devPoints?: number }} taskSpec
 * @returns {Array<{ title: string, description: string, acceptanceCriteria: string[], devPoints: number, parentTaskId: string|undefined }>}
 */
export function decomposeTask(taskSpec) {
  const {
    id,
    title = '',
    description = '',
    acceptanceCriteria = [],
    devPoints = 1,
  } = taskSpec;

  // If no criteria to split on, return single subtask
  if (acceptanceCriteria.length === 0) {
    return [{
      title,
      description,
      acceptanceCriteria: [],
      devPoints,
      parentTaskId: id,
    }];
  }

  const pointsPerCriterion = devPoints / acceptanceCriteria.length;

  return acceptanceCriteria.map((criterion, index) => ({
    title: `${title} — Part ${index + 1}`,
    description: `Subtask of: ${title}\n\nFocus: ${criterion}`,
    acceptanceCriteria: [criterion],
    devPoints: Math.round(pointsPerCriterion * 10) / 10,
    parentTaskId: id,
  }));
}
