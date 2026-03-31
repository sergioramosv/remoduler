/**
 * Dead Letter Queue — queues failed operations with exponential backoff retry.
 * Base delay: 1s, max retries: 3.
 */
import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';

export class DeadLetterQueue {
  #queue = [];
  #maxRetries;
  #baseDelayMs;
  #processing = false;

  constructor(opts = {}) {
    this.#maxRetries = opts.maxRetries ?? config.resilienceDlqMaxRetries ?? 3;
    this.#baseDelayMs = opts.baseDelayMs ?? config.resilienceDlqBaseDelayMs ?? 1000;
  }

  get length() { return this.#queue.length; }

  /**
   * Add a failed operation to the queue.
   * @param {{ id: string, fn: () => Promise<*>, context?: object }} entry
   */
  enqueue(entry) {
    this.#queue.push({ ...entry, retries: 0, lastError: null });
    eventBus.emit('resilience:dlqEnqueued', { id: entry.id, queueLength: this.#queue.length });
  }

  /**
   * Process all queued operations with exponential backoff.
   * @returns {Promise<{ succeeded: string[], failed: string[] }>}
   */
  async processAll() {
    if (this.#processing) return { succeeded: [], failed: [] };
    this.#processing = true;

    const succeeded = [];
    const failed = [];
    const remaining = [];

    for (const entry of this.#queue) {
      const delay = this.#baseDelayMs * Math.pow(2, entry.retries);
      await this.#sleep(delay);

      try {
        await entry.fn();
        succeeded.push(entry.id);
        eventBus.emit('resilience:dlqRetrySuccess', { id: entry.id, retries: entry.retries + 1 });
      } catch (err) {
        entry.retries++;
        entry.lastError = err.message;
        if (entry.retries >= this.#maxRetries) {
          failed.push(entry.id);
          eventBus.emit('resilience:dlqMaxRetries', { id: entry.id, error: err.message });
        } else {
          remaining.push(entry);
        }
      }
    }

    this.#queue = remaining;
    this.#processing = false;
    return { succeeded, failed };
  }

  getEntries() {
    return this.#queue.map(e => ({ id: e.id, retries: e.retries, lastError: e.lastError }));
  }

  clear() {
    this.#queue = [];
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
