import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

let idCounter = 0;

/**
 * DeadLetterQueue — stores failed operations for retry with exponential backoff.
 * Retries: baseDelay * 2^attempt (1s, 2s, 4s). Max 3 attempts.
 */
class DeadLetterQueue {
  #queue = [];
  #maxRetries;
  #baseDelayMs;
  #isProcessing = false;

  constructor(maxRetries, baseDelayMs) {
    this.#maxRetries = maxRetries ?? config.resilienceDlqMaxRetries;
    this.#baseDelayMs = baseDelayMs ?? config.resilienceDlqBaseDelayMs;
  }

  enqueue({ service, operation, payload, error }) {
    const entry = {
      id: `dlq-${++idCounter}`,
      service,
      operation,
      payload,
      error: error?.message || String(error),
      attempts: 0,
      nextRetryAt: Date.now() + this.#baseDelayMs,
      status: 'pending',
    };

    this.#queue.push(entry);
    logger.warn(`DLQ enqueued [${service}/${operation}]: ${entry.error}`, 'RESILIENCE');
    eventBus.emit('resilience:dlq-enqueued', { id: entry.id, service, operation });
    return entry.id;
  }

  async processRetries(retryFn) {
    if (this.#isProcessing) return;
    this.#isProcessing = true;

    try {
      const now = Date.now();
      const ready = this.#queue.filter(e => e.status === 'pending' && e.nextRetryAt <= now);

      for (const entry of ready) {
        entry.attempts++;
        logger.info(`DLQ retry #${entry.attempts} [${entry.service}/${entry.operation}]`, 'RESILIENCE');
        eventBus.emit('resilience:dlq-retry', { id: entry.id, attempt: entry.attempts });

        try {
          await retryFn(entry);
          entry.status = 'resolved';
          logger.info(`DLQ resolved [${entry.service}/${entry.operation}]`, 'RESILIENCE');
        } catch (err) {
          entry.error = err?.message || String(err);

          if (entry.attempts >= this.#maxRetries) {
            entry.status = 'permanently-failed';
            logger.error(`DLQ permanently failed [${entry.service}/${entry.operation}] after ${entry.attempts} attempts`, 'RESILIENCE');
            eventBus.emit('resilience:dlq-permanent-fail', { id: entry.id, service: entry.service, operation: entry.operation, attempts: entry.attempts });
          } else {
            entry.nextRetryAt = now + this.#baseDelayMs * Math.pow(2, entry.attempts);
          }
        }
      }
    } finally {
      this.#isProcessing = false;
    }
  }

  getQueue() {
    return this.#queue.filter(e => e.status === 'pending');
  }

  getPermanentlyFailed() {
    return this.#queue.filter(e => e.status === 'permanently-failed');
  }

  size() {
    return this.#queue.filter(e => e.status === 'pending').length;
  }

  reset() {
    this.#queue = [];
  }
}

export { DeadLetterQueue };
export const deadLetterQueue = new DeadLetterQueue();
