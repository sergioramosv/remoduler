import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { fallbackManager } from '../agents/fallback-manager.js';

const CHECK_INTERVAL = 5 * 60_000; // 5 minutes
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
      logger.info(`Checking if ${cli} has recovered...`, 'HEARTBEAT_MONITOR');

      if (cliResponds(cli)) {
        logger.success(`${cli} recovered!`, 'HEARTBEAT_MONITOR');
        fallbackManager.markRecovered(cli);
        eventBus.emit('CLI_RECOVERED', { cli });
      } else {
        logger.info(`${cli} still rate limited`, 'HEARTBEAT_MONITOR');
      }
    }

    if (fallbackManager.getRateLimitedClis().length === 0) {
      logger.success('All CLIs recovered', 'HEARTBEAT_MONITOR');
      eventBus.emit('heartbeat:allRecovered', {});
    }
  } finally {
    isChecking = false;
  }
}

export function start() {
  if (intervalId) return;
  logger.info(`HeartbeatMonitor started (interval: ${CHECK_INTERVAL / 1000}s)`, 'HEARTBEAT_MONITOR');
  intervalId = setInterval(check, CHECK_INTERVAL);
  check();
}

export function stop() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  logger.info('HeartbeatMonitor stopped', 'HEARTBEAT_MONITOR');
}

export const heartbeatMonitor = { start, stop };
