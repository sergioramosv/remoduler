/**
 * Smart Model Router — epsilon-greedy routing with Firebase historical data.
 */

import { getDb } from '../firebase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const MODEL_POOL = ['claude', 'codex', 'gemini'];

/**
 * Epsilon-greedy model router that explores alternative models with probability epsilon,
 * and exploits the best-performing model otherwise.
 */
export class SmartModelRouter {
  #epsilon;
  #firebasePath;

  constructor({ epsilon, firebasePath = 'triage/modelStats' } = {}) {
    this.#epsilon = epsilon ?? config.triageEpsilon ?? 0.1;
    this.#firebasePath = firebasePath;
  }

  /**
   * Routes to a model using epsilon-greedy strategy.
   * @param {string} role - Agent role
   * @param {string} complexity - Complexity level
   * @returns {Promise<string>} Selected model
   */
  async route(role, complexity) {
    // Epsilon chance: explore random model
    if (Math.random() < this.#epsilon) {
      const randomModel = MODEL_POOL[Math.floor(Math.random() * MODEL_POOL.length)];
      logger.info(`Triage explore: ${role} → ${randomModel}`, 'TRIAGE');
      return randomModel;
    }

    // Exploit: use best model from history
    try {
      const best = await this.getBestModel(role);
      if (best) {
        logger.info(`Triage exploit: ${role} → ${best}`, 'TRIAGE');
        return best;
      }
    } catch (error) {
      logger.warn(`Triage Firebase read failed, using fallback: ${error.message}`, 'TRIAGE');
    }

    // Fallback
    return 'claude';
  }

  /**
   * Records the outcome of a model usage for future routing decisions.
   * @param {string} role - Agent role
   * @param {string} model - Model used
   * @param {{ success: boolean, cost?: number, duration?: number }} outcome
   */
  async recordOutcome(role, model, { success, cost = 0, duration = 0 }) {
    try {
      const ref = getDb().ref(`${this.#firebasePath}/${role}/${model}`);
      const snapshot = await ref.once('value');
      const current = snapshot.val() || {
        successes: 0,
        failures: 0,
        totalCost: 0,
        totalDuration: 0,
        samples: 0,
      };

      await ref.set({
        successes: current.successes + (success ? 1 : 0),
        failures: current.failures + (success ? 0 : 1),
        totalCost: current.totalCost + cost,
        totalDuration: current.totalDuration + duration,
        samples: current.samples + 1,
      });
    } catch (error) {
      logger.warn(`Triage Firebase write failed: ${error.message}`, 'TRIAGE');
    }
  }

  /**
   * Gets the best model for a role based on success/cost ratio from Firebase history.
   * @param {string} role - Agent role
   * @returns {Promise<string|null>} Best model name or null
   */
  async getBestModel(role) {
    const ref = getDb().ref(`${this.#firebasePath}/${role}`);
    const snapshot = await ref.once('value');
    const stats = snapshot.val();

    if (!stats) return null;

    let bestModel = null;
    let bestScore = -Infinity;

    for (const [model, data] of Object.entries(stats)) {
      if (data.samples === 0) continue;

      const successRate = data.successes / data.samples;
      const avgCost = data.totalCost / data.samples;
      // Score: success rate weighted against cost (lower cost is better)
      const score = avgCost > 0 ? successRate / avgCost : successRate;

      if (score > bestScore) {
        bestScore = score;
        bestModel = model;
      }
    }

    return bestModel;
  }
}

export const smartModelRouter = new SmartModelRouter();
