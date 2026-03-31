import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { budgetManager } from '../cost/budget-manager.js';
import { remodulerState } from '../state/remoduler-state.js';
import { Scheduler } from '../scheduler/scheduler.js';

/**
 * Daemon — continuous polling mode that executes tasks one at a time,
 * respecting schedule windows, budget limits, and max task count.
 */
export class Daemon {
  #running = false;
  #executing = false;
  #taskCount = 0;
  #maxTasks = 0;
  #pollInterval = 30000;
  #projectId = null;
  #cwd = process.cwd();
  #scheduler = null;
  #timeoutId = null;

  /**
   * Start the daemon polling loop.
   * @param {string} projectId
   * @param {object} options
   * @param {string} [options.schedule] - HH:MM-HH:MM window override
   * @param {string} [options.timezone] - Timezone override
   * @param {number} [options.maxTasks] - Max tasks (0 = unlimited)
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.focus] - Phase focus
   * @param {number} [options.pollInterval] - Poll interval in ms
   */
  async start(projectId, options = {}) {
    if (this.#running) {
      logger.warn('Daemon is already running', 'DAEMON');
      return;
    }

    this.#projectId = projectId;
    this.#cwd = options.cwd || process.cwd();
    this.#maxTasks = options.maxTasks ?? config.daemonMaxTasks;
    this.#pollInterval = options.pollInterval ?? config.daemonPollIntervalMs;
    this.#taskCount = 0;
    this.#running = true;

    // Create scheduler with overrides or defaults
    const scheduleWindow = options.schedule || config.daemonScheduleWindow;
    const timezone = options.timezone || config.daemonTimezone;
    this.#scheduler = new Scheduler(scheduleWindow, timezone);

    // Set focus if provided
    if (options.focus) {
      const { setFocus } = await import('../state/focus.js');
      await setFocus(options.focus);
      logger.info(`Focus set to phase ${options.focus}`, 'DAEMON');
    }

    eventBus.emit('daemon:started', {
      projectId,
      maxTasks: this.#maxTasks,
      pollInterval: this.#pollInterval,
      schedule: this.#scheduler.getWindowInfo(),
    });

    logger.success(`Daemon started for project ${projectId}`, 'DAEMON');
    logger.info(`Poll interval: ${this.#pollInterval}ms | Max tasks: ${this.#maxTasks || 'unlimited'}`, 'DAEMON');

    // Start the polling loop
    await this.#tick();
  }

  /**
   * Stop the daemon gracefully.
   */
  async stop() {
    if (!this.#running) return;

    logger.info('Stopping daemon...', 'DAEMON');
    this.#running = false;

    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId);
      this.#timeoutId = null;
    }

    // If currently executing, request stop and let the task finish
    if (this.#executing) {
      remodulerState.requestStop();
      logger.info('Waiting for current task to finish...', 'DAEMON');
    }

    eventBus.emit('daemon:stopped', {
      projectId: this.#projectId,
      tasksCompleted: this.#taskCount,
    });

    logger.success(`Daemon stopped. Tasks completed: ${this.#taskCount}`, 'DAEMON');
  }

  /**
   * Single tick of the daemon loop. Uses recursive setTimeout to avoid overlap.
   */
  async #tick() {
    if (!this.#running) return;

    // Check max tasks limit
    if (this.#maxTasks > 0 && this.#taskCount >= this.#maxTasks) {
      logger.info(`Max tasks reached (${this.#maxTasks}). Stopping daemon.`, 'DAEMON');
      await this.stop();
      return;
    }

    // Check stop/pause requests
    if (remodulerState.isStopRequested()) {
      logger.info('Stop requested. Stopping daemon.', 'DAEMON');
      await this.stop();
      return;
    }

    // Check schedule window
    if (!this.#scheduler.isInScheduleWindow()) {
      logger.info('Outside schedule window. Idle.', 'DAEMON');
      eventBus.emit('daemon:idle', { reason: 'outside_schedule' });
      this.#scheduleNext();
      return;
    }

    // Check budget
    if (budgetManager.isExceeded()) {
      logger.warn('Budget exceeded. Idle.', 'DAEMON');
      eventBus.emit('daemon:idle', { reason: 'budget_exceeded' });
      this.#scheduleNext();
      return;
    }

    // Execute one task
    try {
      this.#executing = true;
      const { run } = await import('../orchestrator.js');

      logger.info(`Polling for tasks... (completed: ${this.#taskCount})`, 'DAEMON');
      const result = await run(this.#projectId, {
        tasks: 1,
        cwd: this.#cwd,
      });

      if (result && result.completed > 0) {
        this.#taskCount += result.completed;
        eventBus.emit('daemon:taskDetected', {
          taskCount: this.#taskCount,
          result,
        });
        logger.success(`Task completed. Total: ${this.#taskCount}`, 'DAEMON');
      } else {
        eventBus.emit('daemon:idle', { reason: 'no_tasks' });
        logger.info('No tasks available. Idle.', 'DAEMON');
      }
    } catch (error) {
      logger.error(`Daemon tick error: ${error.message}`, 'DAEMON');
    } finally {
      this.#executing = false;
    }

    // Schedule next tick
    this.#scheduleNext();
  }

  /**
   * Schedule the next tick after the poll interval.
   */
  #scheduleNext() {
    if (!this.#running) return;
    this.#timeoutId = setTimeout(() => this.#tick(), this.#pollInterval);
  }

  /**
   * Returns whether the daemon is currently running.
   */
  isRunning() {
    return this.#running;
  }

  /**
   * Returns daemon status info.
   */
  getStatus() {
    return {
      running: this.#running,
      executing: this.#executing,
      taskCount: this.#taskCount,
      maxTasks: this.#maxTasks,
      projectId: this.#projectId,
    };
  }
}

export const daemon = new Daemon();
