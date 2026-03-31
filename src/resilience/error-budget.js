/**
 * Error Budget — tracks failure rate in a rolling window.
 * Window: 30min, max rate: 30%. Auto-pauses when exceeded.
 */
import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';

export class ErrorBudget {
  #windowMs;
  #maxRate;
  #entries = [];
  #paused = false;

  constructor(opts = {}) {
    this.#windowMs = opts.windowMs ?? config.resilienceErrorBudgetWindowMs ?? 1800000;
    this.#maxRate = opts.maxRate ?? config.resilienceErrorBudgetMaxRate ?? 0.3;
  }

  get paused() { return this.#paused; }

  record(success) {
    this.#entries.push({ timestamp: Date.now(), success });
    this.#prune();
    this.#evaluate();
  }

  #prune() {
    const cutoff = Date.now() - this.#windowMs;
    this.#entries = this.#entries.filter(e => e.timestamp >= cutoff);
  }

  #evaluate() {
    if (this.#entries.length < 3) return;
    const failures = this.#entries.filter(e => !e.success).length;
    const rate = failures / this.#entries.length;
    if (rate >= this.#maxRate && !this.#paused) {
      this.#paused = true;
      eventBus.emit('resilience:budgetExceeded', { rate, failures, total: this.#entries.length });
    } else if (rate < this.#maxRate && this.#paused) {
      this.#paused = false;
      eventBus.emit('resilience:budgetRecovered', { rate });
    }
  }

  getStats() {
    this.#prune();
    const total = this.#entries.length;
    const failures = this.#entries.filter(e => !e.success).length;
    return { total, failures, rate: total > 0 ? failures / total : 0, paused: this.#paused };
  }

  reset() {
    this.#entries = [];
    this.#paused = false;
  }
}
