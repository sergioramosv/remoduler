import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ErrorBudget } from './error-budget.js';
import { DeadLetterQueue } from './dead-letter-queue.js';

const DLQ_PROCESS_INTERVAL_MS = 10000;

/**
 * ResilienceManager — coordinator that wires circuit breakers, error budget, and DLQ.
 * Exposes execute(service, fn) that routes through circuit breaker,
 * records results in error budget, and sends failures to DLQ.
 */
class ResilienceManager {
  #breakers = new Map();
  #errorBudget;
  #dlq;
  #retryIntervalId = null;
  #initialized = false;

  constructor() {
    this.#errorBudget = new ErrorBudget(
      config.resilienceErrorBudgetWindowMs,
      config.resilienceErrorBudgetMaxRate,
    );
    this.#dlq = new DeadLetterQueue(
      config.resilienceDlqMaxRetries,
      config.resilienceDlqBaseDelayMs,
    );

    for (const [service, threshold] of Object.entries(config.resilienceThresholds)) {
      this.#breakers.set(service, new CircuitBreaker(service, threshold, config.resilienceCooldownMs));
    }
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#retryIntervalId = setInterval(() => {
      this.#dlq.processRetries(async (entry) => {
        const breaker = this.#breakers.get(entry.service);
        if (breaker && breaker.getState() === 'OPEN') {
          throw new Error(`Circuit breaker still OPEN for ${entry.service}`);
        }
        // Re-throw to signal DLQ that the operation needs an external retry function
        throw new Error(`No automatic retry handler for ${entry.service}/${entry.operation}`);
      });
    }, DLQ_PROCESS_INTERVAL_MS);

    logger.info('Resilience manager initialized', 'RESILIENCE');
    eventBus.emit('resilience:initialized', { services: [...this.#breakers.keys()] });
  }

  shutdown() {
    if (this.#retryIntervalId) {
      clearInterval(this.#retryIntervalId);
      this.#retryIntervalId = null;
    }
    this.#initialized = false;
    logger.info('Resilience manager shut down', 'RESILIENCE');
  }

  async execute(service, fn) {
    const breaker = this.#breakers.get(service);
    if (!breaker) {
      throw new Error(`Unknown service '${service}' — no circuit breaker configured`);
    }

    try {
      const result = await breaker.execute(fn);
      this.#errorBudget.record(true);
      return result;
    } catch (err) {
      this.#errorBudget.record(false);
      this.#dlq.enqueue({
        service,
        operation: fn.name || 'anonymous',
        payload: null,
        error: err,
      });
      throw err;
    }
  }

  getStatus() {
    const breakers = {};
    for (const [service, breaker] of this.#breakers) {
      breakers[service] = breaker.getState();
    }

    return {
      breakers,
      errorBudgetRate: this.#errorBudget.getRate(),
      errorBudgetExhausted: this.#errorBudget.isExhausted(),
      dlqSize: this.#dlq.size(),
      dlqPermanentlyFailed: this.#dlq.getPermanentlyFailed().length,
    };
  }

  getBreaker(service) {
    return this.#breakers.get(service);
  }

  get initialized() {
    return this.#initialized;
  }
}

export { ResilienceManager };
export const resilienceManager = new ResilienceManager();
