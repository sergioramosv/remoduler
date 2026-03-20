import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

export const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

/**
 * CircuitBreaker — protects a service from cascading failures.
 * States: CLOSED → OPEN (after threshold failures) → HALF_OPEN (after cooldown) → CLOSED (on success).
 * One instance per service, created by ResilienceManager.
 */
class CircuitBreaker {
  #service;
  #state = CIRCUIT_STATES.CLOSED;
  #failures = 0;
  #threshold;
  #cooldownMs;
  #lastFailureTime = 0;

  constructor(service, threshold, cooldownMs) {
    this.#service = service;
    this.#threshold = threshold ?? config.resilienceThresholds[service] ?? 5;
    this.#cooldownMs = cooldownMs ?? config.resilienceCooldownMs;
  }

  async execute(fn) {
    if (this.#state === CIRCUIT_STATES.OPEN) {
      if (Date.now() - this.#lastFailureTime >= this.#cooldownMs) {
        this.#transitionTo(CIRCUIT_STATES.HALF_OPEN);
      } else {
        throw new Error(`Circuit breaker OPEN for service '${this.#service}'`);
      }
    }

    try {
      const result = await fn();
      this.#recordSuccess();
      return result;
    } catch (err) {
      this.#recordFailure();
      throw err;
    }
  }

  #recordSuccess() {
    if (this.#state === CIRCUIT_STATES.HALF_OPEN) {
      this.#failures = 0;
      this.#transitionTo(CIRCUIT_STATES.CLOSED);
    }
    this.#failures = 0;
  }

  #recordFailure() {
    this.#failures++;
    this.#lastFailureTime = Date.now();

    if (this.#state === CIRCUIT_STATES.HALF_OPEN) {
      this.#transitionTo(CIRCUIT_STATES.OPEN);
      return;
    }

    if (this.#failures >= this.#threshold) {
      this.#transitionTo(CIRCUIT_STATES.OPEN);
    }
  }

  #transitionTo(newState) {
    const previous = this.#state;
    this.#state = newState;

    const eventMap = {
      [CIRCUIT_STATES.OPEN]: 'resilience:circuit-open',
      [CIRCUIT_STATES.HALF_OPEN]: 'resilience:circuit-half-open',
      [CIRCUIT_STATES.CLOSED]: 'resilience:circuit-closed',
    };

    logger.info(`Circuit breaker [${this.#service}]: ${previous} → ${newState}`, 'RESILIENCE');
    eventBus.emit(eventMap[newState], { service: this.#service, previous, current: newState });
  }

  getState() {
    return this.#state;
  }

  getService() {
    return this.#service;
  }

  reset() {
    this.#failures = 0;
    this.#lastFailureTime = 0;
    this.#state = CIRCUIT_STATES.CLOSED;
  }
}

export { CircuitBreaker };
