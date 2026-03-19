import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

/**
 * ApprovalChannels — registra canales de aprobación (dashboard, api)
 * y unifica las respuestas en un solo evento para approval-gate.
 */
class ApprovalChannels {
  #channels = new Map();

  constructor() {
    this.registerChannel('dashboard');
    this.registerChannel('api');
  }

  /**
   * Registra un canal de aprobación.
   */
  registerChannel(name) {
    this.#channels.set(name, { name, active: true });
    logger.info(`Approval channel registered: ${name}`, 'AUTONOMY');
  }

  /**
   * Notifica todos los canales activos de una solicitud de aprobación.
   * Emite 'autonomy:approval-request' para que firebase-sync (u otros) lo capturen.
   */
  notifyChannels(request) {
    const activeChannels = [...this.#channels.values()].filter(c => c.active);
    logger.info(`Requesting approval via ${activeChannels.length} channel(s): ${activeChannels.map(c => c.name).join(', ')}`, 'AUTONOMY');
    eventBus.emit('autonomy:approval-request', {
      ...request,
      channels: activeChannels.map(c => c.name),
      requestedAt: Date.now(),
    });
  }

  /**
   * Escucha la respuesta de aprobación para un requestId específico.
   * Retorna Promise que resuelve cuando EventBus recibe 'autonomy:approval-response'
   * con el requestId correspondiente.
   */
  listenForResponse(requestId) {
    let handler;
    const promise = new Promise((resolve) => {
      handler = (response) => {
        if (response.requestId === requestId) {
          eventBus.off('autonomy:approval-response', handler);
          resolve(response);
        }
      };
      eventBus.on('autonomy:approval-response', handler);
    });
    const cancel = () => eventBus.off('autonomy:approval-response', handler);
    return { promise, cancel };
  }

  getChannels() {
    return [...this.#channels.values()];
  }
}

export { ApprovalChannels };
export const approvalChannels = new ApprovalChannels();
