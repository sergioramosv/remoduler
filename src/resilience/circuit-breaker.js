/**
 * Circuit Breaker — protects external service calls with CLOSED/OPEN/HALF_OPEN states.
 * Thresholds per service: firebase=5, github=3, cli=4. Cooldown 60s.
 */
import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

export class CircuitBreaker {
  #service;
  #threshold;
  #cooldownMs;
  #state = STATES.CLOSED;
  #failures = 0;
  #lastFailureAt = 0;

  /**
   * @param {string} service - Service name (firebase, github, cli)
   * @param {{ threshold?: number, cooldownMs?: number }} opts
   */
  constructor(service, opts = {}) {
    this.#service = service;
    const thresholds = config.resilienceThresholds || { firebase: 5, github: 3, cli: 4 };
    this.#threshold = opts.threshold ?? thresholds[service] ?? 5;
    this.#cooldownMs = opts.cooldownMs ?? config.resilienceCooldownMs ?? 60000;
  }

  get state() { return this.#state; }
  get service() { return this.#service; }
  get failures() { return this.#failures; }

  /**
   * Execute an async operation through the circuit breaker.
   * @param {() => Promise<*>} fn
   * @returns {Promise<*>}
   */
  async exec(fn) {
    if (this.#state === STATES.OPEN) {
      if (Date.now() - this.#lastFailureAt >= this.#cooldownMs) {
        this.#state = STATES.HALF_OPEN;
        eventBus.emit('resilience:halfOpen', { service: this.#service });
      } else {
        throw new Error(`Circuit OPEN for ${this.#service} — cooldown active`);
      }
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (err) {
      this.#onFailure();
      throw err;
    }
  }

  #onSuccess() {
    if (this.#state === STATES.HALF_OPEN) {
      eventBus.emit('resilience:closed', { service: this.#service });
    }
    this.#failures = 0;
    this.#state = STATES.CLOSED;
  }

  #onFailure() {
    this.#failures++;
    this.#lastFailureAt = Date.now();
    if (this.#failures >= this.#threshold) {
      this.#state = STATES.OPEN;
      eventBus.emit('resilience:open', { service: this.#service, failures: this.#failures });
    }
  }

  reset() {
    this.#state = STATES.CLOSED;
    this.#failures = 0;
    this.#lastFailureAt = 0;
  }
}

export { STATES };
