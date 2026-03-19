import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { config } from '../config.js';

/**
 * Heartbeat — comprueba periódicamente si los CLIs se han recuperado del rate limit.
 * Cuando detecta recuperación, emite evento para que el orchestrator reanude.
 *
 * Cómo funciona:
 * - Cada INTERVAL ms, intenta un comando barato al CLI (--version)
 * - Si responde → el CLI está disponible → emite 'heartbeat:recovered'
 * - Si no responde → sigue esperando
 */

const CHECK_INTERVAL = 60_000; // 1 minuto
let intervalId = null;
let isChecking = false;

function cliResponds(cli) {
  try {
    execSync(`${cli} --version`, {
      stdio: 'pipe',
      timeout: 10_000,
      shell: process.platform === 'win32',
    });
    return true;
  } catch {
    return false;
  }
}

async function check() {
  if (isChecking) return;
  isChecking = true;

  try {
    const rateLimitedClis = fallbackManager.getRateLimitedClis();
    if (rateLimitedClis.length === 0) return;

    for (const cli of rateLimitedClis) {
      logger.info(`Checking if ${cli} has recovered...`, 'HEARTBEAT');

      if (cliResponds(cli)) {
        logger.success(`${cli} recovered!`, 'HEARTBEAT');
        fallbackManager.markRecovered(cli);
        eventBus.emit('heartbeat:recovered', { cli });
      } else {
        logger.info(`${cli} still rate limited`, 'HEARTBEAT');
      }
    }

    // If all CLIs are recovered, emit ready event
    if (fallbackManager.getRateLimitedClis().length === 0) {
      logger.success('All CLIs recovered — ready to resume', 'HEARTBEAT');
      eventBus.emit('heartbeat:allRecovered', {});
    }
  } finally {
    isChecking = false;
  }
}

export function startHeartbeat() {
  if (intervalId) return;
  logger.info(`Heartbeat started (checking every ${CHECK_INTERVAL / 1000}s)`, 'HEARTBEAT');
  intervalId = setInterval(check, CHECK_INTERVAL);
  // First check immediately
  check();
}

export function stopHeartbeat() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Heartbeat stopped', 'HEARTBEAT');
  }
}
