import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { approvalChannels } from './approval-channels.js';

let requestCounter = 0;

/**
 * ApprovalGate — waitForApproval() con timeout configurable.
 * Emite evento pidiendo aprobación, espera respuesta, resuelve con approved/denied/timeout.
 */
class ApprovalGate {
  /**
   * Solicita aprobación humana y espera respuesta.
   * @param {{ action: string, context: object, reasons: string[] }} params
   * @returns {Promise<{ approved: boolean, respondedBy: string|null, timedOut: boolean }>}
   */
  async waitForApproval({ action, context = {}, reasons = [] }) {
    const requestId = `approval-${Date.now()}-${++requestCounter}`;
    const timeoutMs = config.autonomyApprovalTimeoutMs;

    logger.info(`Approval requested for '${action}' (timeout: ${timeoutMs / 1000}s)`, 'AUTONOMY');
    logger.info(`Reasons: ${reasons.join('; ')}`, 'AUTONOMY');

    const request = { requestId, action, context, reasons, status: 'pending' };

    // Notify all channels
    approvalChannels.notifyChannels(request);

    // Race: response vs timeout
    const result = await Promise.race([
      approvalChannels.listenForResponse(requestId),
      this.#timeout(timeoutMs, requestId),
    ]);

    if (result.timedOut) {
      logger.warn(`Approval timed out for '${action}' — denied by default`, 'AUTONOMY');
      eventBus.emit('autonomy:approval-timeout', { requestId, action });
    } else {
      logger.info(`Approval ${result.approved ? 'granted' : 'denied'} for '${action}' by ${result.respondedBy}`, 'AUTONOMY');
    }

    return {
      approved: result.approved || false,
      respondedBy: result.respondedBy || null,
      timedOut: result.timedOut || false,
    };
  }

  #timeout(ms, requestId) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ requestId, approved: false, respondedBy: null, timedOut: true });
      }, ms);
    });
  }
}

export { ApprovalGate };
export const approvalGate = new ApprovalGate();
