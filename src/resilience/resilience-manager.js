/**
 * Resilience Manager — coordinates circuit breakers, error budget, and DLQ.
 */
import { CircuitBreaker } from './circuit-breaker.js';
import { ErrorBudget } from './error-budget.js';
import { DeadLetterQueue } from './dead-letter-queue.js';
import { eventBus } from '../events/event-bus.js';

class ResilienceManager {
  #breakers = new Map();
  #errorBudget = new ErrorBudget();
  #dlq = new DeadLetterQueue();

  /**
   * Get or create a circuit breaker for a service.
   * @param {string} service
   * @returns {CircuitBreaker}
   */
  getBreaker(service) {
    if (!this.#breakers.has(service)) {
      this.#breakers.set(service, new CircuitBreaker(service));
    }
    return this.#breakers.get(service);
  }

  /**
   * Execute an operation through the circuit breaker + error budget.
   * On failure, enqueues to DLQ.
   * @param {string} service
   * @param {() => Promise<*>} fn
   * @param {{ id?: string, context?: object }} opts
   */
  async exec(service, fn, opts = {}) {
    if (this.#errorBudget.paused) {
      throw new Error('Error budget exceeded — system paused');
    }

    const breaker = this.getBreaker(service);
    try {
      const result = await breaker.exec(fn);
      this.#errorBudget.record(true);
      return result;
    } catch (err) {
      this.#errorBudget.record(false);
      if (opts.id) {
        this.#dlq.enqueue({ id: opts.id, fn, context: opts.context });
      }
      throw err;
    }
  }

  async retryFailed() {
    return this.#dlq.processAll();
  }

  getStatus() {
    const breakers = {};
    for (const [name, breaker] of this.#breakers) {
      breakers[name] = { state: breaker.state, failures: breaker.failures };
    }
    return {
      breakers,
      errorBudget: this.#errorBudget.getStats(),
      dlq: { length: this.#dlq.length, entries: this.#dlq.getEntries() },
    };
  }

  reset() {
    for (const breaker of this.#breakers.values()) breaker.reset();
    this.#errorBudget.reset();
    this.#dlq.clear();
  }
}

export const resilienceManager = new ResilienceManager();
export { ResilienceManager };
