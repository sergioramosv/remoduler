import { eventBus } from '../events/event-bus.js';

/**
 * Estado global del orquestador. Singleton.
 * Emite eventos en cada cambio para que WS/Dashboard reaccionen.
 */
class RemodulerState {
  #state = this.#initialState();

  #initialState() {
    return {
      execution: 'idle', // idle | running | paused | stopped
      currentTask: null,
      currentAgent: null,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalCost: 0,
      startedAt: null,
      pauseRequested: false,
      stopRequested: false,
    };
  }

  get state() { return { ...this.#state }; }

  setExecution(status) {
    this.#state.execution = status;
    if (status === 'running' && !this.#state.startedAt) this.#state.startedAt = Date.now();
    eventBus.emit('state:execution', { execution: status });
  }

  setCurrentTask(task) {
    this.#state.currentTask = task;
    eventBus.emit('state:task', { task });
  }

  setCurrentAgent(name) {
    this.#state.currentAgent = name;
    eventBus.emit('state:agent', { agent: name });
  }

  taskCompleted(cost = 0) {
    this.#state.tasksCompleted++;
    this.#state.totalCost += cost;
    this.#state.currentTask = null;
    this.#state.currentAgent = null;
    eventBus.emit('state:taskCompleted', { completed: this.#state.tasksCompleted, cost: this.#state.totalCost });
  }

  taskFailed(error) {
    this.#state.tasksFailed++;
    this.#state.currentTask = null;
    this.#state.currentAgent = null;
    eventBus.emit('state:taskFailed', { error });
  }

  addCost(amount) { this.#state.totalCost += amount; }
  requestPause() { this.#state.pauseRequested = true; eventBus.emit('state:pause', {}); }
  requestStop() { this.#state.stopRequested = true; eventBus.emit('state:stop', {}); }
  isPauseRequested() { return this.#state.pauseRequested; }
  isStopRequested() { return this.#state.stopRequested; }

  reset() {
    this.#state = this.#initialState();
    eventBus.emit('state:reset', {});
  }
}

export const remodulerState = new RemodulerState();
