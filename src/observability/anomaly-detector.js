import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

const TOKEN_SPIKE_MULTIPLIER = parseFloat(process.env.ANOMALY_TOKEN_SPIKE || '3');
const REVIEW_REGRESSION_THRESHOLD = parseFloat(process.env.ANOMALY_REVIEW_REGRESSION || '0.5');

/**
 * AnomalyDetector — detects token spikes, review regressions, and model degradation.
 */
export class AnomalyDetector {
  #tokenHistory = [];
  #reviewScoreHistory = [];
  #modelLatencyHistory = new Map(); // model → latency[]

  /**
   * Records token usage and detects spikes vs rolling average.
   * @param {{ input: number, output: number, total: number, taskId: string }} usage
   */
  recordTokenUsage(usage) {
    this.#tokenHistory.push(usage.total);
    if (this.#tokenHistory.length > 50) this.#tokenHistory.shift();

    const avg = this.#rollingAvg(this.#tokenHistory.slice(0, -1));
    if (avg > 0 && usage.total > avg * TOKEN_SPIKE_MULTIPLIER) {
      logger.warn(
        `Token spike detected: ${usage.total.toLocaleString()} tokens (avg: ${Math.round(avg).toLocaleString()}, ${TOKEN_SPIKE_MULTIPLIER}x threshold)`,
        'ANOMALY'
      );
      eventBus.emit('anomaly:tokenSpike', { taskId: usage.taskId, tokens: usage.total, avg, multiplier: TOKEN_SPIKE_MULTIPLIER });
    }
  }

  /**
   * Records a review score (0-1) and detects regression.
   * @param {{ score: number, taskId: string, model: string }} review
   */
  recordReviewScore(review) {
    this.#reviewScoreHistory.push(review.score);
    if (this.#reviewScoreHistory.length > 20) this.#reviewScoreHistory.shift();

    const avg = this.#rollingAvg(this.#reviewScoreHistory.slice(0, -1));
    if (avg > 0 && review.score < avg * REVIEW_REGRESSION_THRESHOLD) {
      logger.warn(
        `Review regression detected: score ${review.score.toFixed(2)} vs avg ${avg.toFixed(2)} for ${review.model}`,
        'ANOMALY'
      );
      eventBus.emit('anomaly:reviewRegression', { taskId: review.taskId, score: review.score, avg, model: review.model });
    }
  }

  /**
   * Records model latency and detects degradation (2x slower than average).
   * @param {{ model: string, latencyMs: number, taskId: string }} entry
   */
  recordModelLatency(entry) {
    if (!this.#modelLatencyHistory.has(entry.model)) {
      this.#modelLatencyHistory.set(entry.model, []);
    }

    const history = this.#modelLatencyHistory.get(entry.model);
    history.push(entry.latencyMs);
    if (history.length > 20) history.shift();

    const avg = this.#rollingAvg(history.slice(0, -1));
    if (avg > 0 && entry.latencyMs > avg * 2) {
      logger.warn(
        `Model degradation: ${entry.model} took ${entry.latencyMs}ms (avg: ${Math.round(avg)}ms)`,
        'ANOMALY'
      );
      eventBus.emit('anomaly:modelDegradation', { model: entry.model, latencyMs: entry.latencyMs, avg });
    }
  }

  #rollingAvg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }
}

export const anomalyDetector = new AnomalyDetector();
