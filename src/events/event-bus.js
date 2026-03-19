/**
 * EventBus — pub/sub global para comunicación entre componentes.
 * Eventos: task:start, task:complete, agent:start, agent:done, state:change, etc.
 */
class EventBus {
  #listeners = new Map();

  on(event, callback) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const list = this.#listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit(event, data) {
    const list = this.#listeners.get(event);
    if (list) {
      for (const cb of list) {
        try { cb(data); } catch (err) {
          console.error(`EventBus error on '${event}':`, err.message);
        }
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}

export const eventBus = new EventBus();
