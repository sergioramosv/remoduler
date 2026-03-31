import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

const POLL_INTERVAL_MS = parseInt(process.env.CI_POLL_INTERVAL_MS || '30000');
const AUTO_REVERT = process.env.AUTO_REVERT === 'true';

/**
 * CiMonitor — polls GitHub Actions workflow runs for a branch.
 * Auto-reverts if CI fails and AUTO_REVERT=true.
 */
export class CiMonitor {
  #cwd = null;
  #branch = null;
  #intervalId = null;
  #running = false;

  /**
   * Start monitoring CI for a branch.
   * @param {string} cwd
   * @param {string} branch
   */
  start(cwd, branch) {
    if (this.#running) return;
    this.#cwd = cwd;
    this.#branch = branch;
    this.#running = true;
    logger.info(`CiMonitor started for branch ${branch} (poll every ${POLL_INTERVAL_MS}ms)`, 'CI_MONITOR');
    this.#intervalId = setInterval(() => this.#poll(), POLL_INTERVAL_MS);
    this.#poll();
  }

  stop() {
    if (!this.#running) return;
    clearInterval(this.#intervalId);
    this.#intervalId = null;
    this.#running = false;
    logger.info('CiMonitor stopped', 'CI_MONITOR');
  }

  async #poll() {
    try {
      const status = this.#getWorkflowStatus();
      logger.info(`CI status for ${this.#branch}: ${status}`, 'CI_MONITOR');

      if (status === 'success') {
        eventBus.emit('ci:success', { branch: this.#branch });
        this.stop();
      } else if (status === 'failure') {
        logger.warn(`CI FAILED on branch ${this.#branch}`, 'CI_MONITOR');
        eventBus.emit('ci:failure', { branch: this.#branch, autoRevert: AUTO_REVERT });

        if (AUTO_REVERT) {
          this.#revert();
        }
        this.stop();
      }
    } catch (err) {
      logger.error(`CiMonitor poll error: ${err.message}`, 'CI_MONITOR');
    }
  }

  #getWorkflowStatus() {
    const out = execSync(
      `gh run list --branch ${this.#branch} --limit 1 --json status,conclusion --jq '.[0]'`,
      { cwd: this.#cwd, stdio: 'pipe', shell: process.platform === 'win32' }
    ).toString().trim();

    if (!out || out === 'null') return 'pending';

    const run = JSON.parse(out);
    if (run.status === 'in_progress' || run.status === 'queued') return 'running';
    if (run.conclusion === 'success') return 'success';
    if (run.conclusion === 'failure' || run.conclusion === 'cancelled') return 'failure';
    return 'pending';
  }

  #revert() {
    try {
      logger.warn(`AUTO_REVERT: reverting ${this.#branch}...`, 'CI_MONITOR');
      execSync(`git revert HEAD --no-edit`, { cwd: this.#cwd, stdio: 'pipe', shell: process.platform === 'win32' });
      execSync(`git push origin ${this.#branch}`, { cwd: this.#cwd, stdio: 'pipe', shell: process.platform === 'win32' });
      logger.success(`Reverted ${this.#branch}`, 'CI_MONITOR');
      eventBus.emit('ci:reverted', { branch: this.#branch });
    } catch (err) {
      logger.error(`Auto-revert failed: ${err.message}`, 'CI_MONITOR');
    }
  }
}

export const ciMonitor = new CiMonitor();
