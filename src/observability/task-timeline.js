import { getDb } from '../firebase.js';
import { logger } from '../utils/logger.js';

/**
 * TaskTimeline — stores phase durations, costs, and transitions per task.
 */
export class TaskTimeline {
  #timelines = new Map(); // taskId → timeline

  /**
   * Start tracking a phase for a task.
   * @param {string} taskId
   * @param {string} phase - e.g. 'plan', 'code', 'review', 'fix'
   */
  startPhase(taskId, phase) {
    if (!this.#timelines.has(taskId)) {
      this.#timelines.set(taskId, { taskId, phases: [], totalCostUsd: 0, startedAt: Date.now() });
    }
    const timeline = this.#timelines.get(taskId);
    timeline.phases.push({ phase, startedAt: Date.now(), endedAt: null, durationMs: null, costUsd: 0 });
  }

  /**
   * End the current phase for a task and record its cost.
   * @param {string} taskId
   * @param {string} phase
   * @param {number} [costUsd]
   */
  endPhase(taskId, phase, costUsd = 0) {
    const timeline = this.#timelines.get(taskId);
    if (!timeline) return;

    const phaseEntry = [...timeline.phases].reverse().find(p => p.phase === phase && !p.endedAt);
    if (!phaseEntry) return;

    phaseEntry.endedAt = Date.now();
    phaseEntry.durationMs = phaseEntry.endedAt - phaseEntry.startedAt;
    phaseEntry.costUsd = costUsd;
    timeline.totalCostUsd += costUsd;
  }

  /**
   * Finalize the timeline and persist to Firebase.
   * @param {string} taskId
   * @param {string} projectId
   */
  async finalize(taskId, projectId) {
    const timeline = this.#timelines.get(taskId);
    if (!timeline) return;

    timeline.completedAt = Date.now();
    timeline.totalDurationMs = timeline.completedAt - timeline.startedAt;

    try {
      await getDb().ref(`remoduler/${projectId}/timelines/${taskId}`).set(timeline);
      logger.info(`Timeline saved for task ${taskId} (${timeline.totalDurationMs}ms, $${timeline.totalCostUsd.toFixed(4)})`, 'TIMELINE');
    } catch (err) {
      logger.error(`Timeline save failed: ${err.message}`, 'TIMELINE');
    }

    this.#timelines.delete(taskId);
    return timeline;
  }

  getTimeline(taskId) {
    return this.#timelines.get(taskId) || null;
  }
}

export const taskTimeline = new TaskTimeline();
