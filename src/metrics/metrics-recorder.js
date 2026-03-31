import { getDb } from '../firebase.js';
import { logger } from '../utils/logger.js';

/**
 * MetricsRecorder — records task, model, and routing metrics to Firebase.
 */
class MetricsRecorder {
  #projectId = null;

  initialize(projectId) {
    this.#projectId = projectId;
  }

  /**
   * Records metrics for a completed task.
   * @param {{ taskId: string, title: string, durationMs: number, costUsd: number, tokens: object, reviewCycles: number, success: boolean }} metrics
   */
  async recordTaskMetrics(metrics) {
    await this.#write(`remoduler/${this.#projectId}/metrics/tasks/${metrics.taskId}`, {
      ...metrics,
      recordedAt: Date.now(),
    });
    logger.info(`Task metrics recorded: ${metrics.taskId} (${metrics.durationMs}ms, $${metrics.costUsd?.toFixed(4)})`, 'METRICS');
  }

  /**
   * Records model performance data.
   * @param {{ model: string, taskId: string, latencyMs: number, tokensIn: number, tokensOut: number, success: boolean }} data
   */
  async recordModelPerformance(data) {
    const key = `${Date.now()}_${data.taskId}`;
    await this.#write(`remoduler/${this.#projectId}/metrics/models/${data.model}/${key}`, {
      ...data,
      recordedAt: Date.now(),
    });
  }

  /**
   * Records a routing decision outcome (which model/CLI was chosen and why).
   * @param {{ taskId: string, model: string, cli: string, reason: string, complexity: string, success: boolean }} outcome
   */
  async recordRoutingOutcome(outcome) {
    const key = `${Date.now()}_${outcome.taskId}`;
    await this.#write(`remoduler/${this.#projectId}/metrics/routing/${key}`, {
      ...outcome,
      recordedAt: Date.now(),
    });
  }

  async #write(path, data) {
    if (!this.#projectId) return;
    try {
      await getDb().ref(path).set(data);
    } catch (err) {
      logger.error(`Metrics write failed (${path}): ${err.message}`, 'METRICS');
    }
  }
}

export const metricsRecorder = new MetricsRecorder();
