import { logger } from '../utils/logger.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Forwards an event payload to a list of webhook URLs with exponential backoff.
 * @param {string[]} urls - Target webhook URLs
 * @param {string} event - Event name
 * @param {object} payload - Event data
 * @returns {Promise<{ url: string, success: boolean }[]>}
 */
export async function forwardWebhook(urls, event, payload) {
  const results = await Promise.all(urls.map(url => sendWithRetry(url, event, payload)));
  return results;
}

async function sendWithRetry(url, event, payload) {
  const body = JSON.stringify({ event, payload, timestamp: Date.now() });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        logger.info(`Webhook delivered to ${url} (attempt ${attempt})`, 'WEBHOOK');
        return { url, success: true };
      }

      logger.warn(`Webhook to ${url} returned ${res.status} (attempt ${attempt}/${MAX_RETRIES})`, 'WEBHOOK');
    } catch (err) {
      logger.warn(`Webhook to ${url} failed: ${err.message} (attempt ${attempt}/${MAX_RETRIES})`, 'WEBHOOK');
    }

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }

  logger.error(`Webhook to ${url} failed after ${MAX_RETRIES} attempts`, 'WEBHOOK');
  return { url, success: false };
}

/**
 * Registers event bus events to forward to configured webhook URLs.
 * @param {import('../events/event-bus.js').EventBus} eventBus
 * @param {string[]} events - Event names to forward
 * @param {string[]} urls - Target URLs
 */
export function registerWebhookForwarding(eventBus, events, urls) {
  if (!urls?.length) return;

  for (const event of events) {
    eventBus.on(event, payload => {
      forwardWebhook(urls, event, payload).catch(err =>
        logger.error(`Webhook forwarding error: ${err.message}`, 'WEBHOOK')
      );
    });
  }

  logger.info(`Webhook forwarding registered for ${events.length} events to ${urls.length} URL(s)`, 'WEBHOOK');
}
