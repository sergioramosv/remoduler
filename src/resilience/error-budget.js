import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

/**
 * ErrorBudget — tracks error rate over a sliding window.
 * When failure rate exceeds maxRate, emits auto-pause event.
 */
class ErrorBudget {
  #entries = [];
  #windowMs;
  #maxRate;
  #exhaustedEmitted = false;

  constructor(windowMs, maxRate) {
    this.#windowMs = windowMs ?? config.resilienceErrorBudgetWindowMs;
    this.#maxRate = maxRate ?? config.resilienceErrorBudgetMaxRate;
  }

  record(success) {
    this.#prune();
    this.#entries.push({ timestamp: Date.now(), success });

    if (this.isExhausted() && !this.#exhaustedEmitted) {
      this.#exhaustedEmitted = true;
      logger.warn(`Error budget exhausted — failure rate ${(this.getRate() * 100).toFixed(1)}% exceeds ${(this.#maxRate * 100).toFixed(1)}%`, 'RESILIENCE');
      eventBus.emit('resilience:budget-exhausted', { rate: this.getRate(), maxRate: this.#maxRate });
      eventBus.emit('resilience:auto-pause', { reason: 'error-budget-exhausted', rate: this.getRate() });
    }

    // Reset flag when rate recovers
    if (!this.isExhausted()) {
      this.#exhaustedEmitted = false;
    }
  }

  getRate() {
    this.#prune();
    if (this.#entries.length === 0) return 0;
    const failures = this.#entries.filter(e => !e.success).length;
    return failures / this.#entries.length;
  }

  isExhausted() {
    return this.getRate() > this.#maxRate;
  }

  reset() {
    this.#entries = [];
    this.#exhaustedEmitted = false;
  }

  #prune() {
    const cutoff = Date.now() - this.#windowMs;
    this.#entries = this.#entries.filter(e => e.timestamp >= cutoff);
  }
}

export { ErrorBudget };
export const errorBudget = new ErrorBudget();
