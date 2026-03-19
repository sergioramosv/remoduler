import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { guardianGates } from './guardian-gates.js';
import { approvalGate } from './approval-gate.js';

/**
 * Niveles de autonomía del sistema.
 */
export const AUTONOMY_LEVELS = {
  SUPERVISED: 'supervised',
  SEMI_AUTONOMOUS: 'semi-autonomous',
  AUTONOMOUS: 'autonomous',
  GUARDIAN: 'guardian',
};

const VALID_LEVELS = new Set(Object.values(AUTONOMY_LEVELS));

/**
 * AutonomyEngine — motor principal con 4 niveles de autonomía.
 *
 * - SUPERVISED: todo requiere aprobación humana.
 * - SEMI_AUTONOMOUS: solo pide aprobación si guardian gates se activan.
 * - AUTONOMOUS: nunca pide aprobación, solo loguea.
 * - GUARDIAN: como autonomous pero bloquea automáticamente si gates críticos se activan (sin aprobación humana).
 */
class AutonomyEngine {
  #level;

  constructor() {
    this.#level = this.#resolveLevel(config.autonomyLevel);
    logger.info(`Autonomy engine initialized at level: ${this.#level}`, 'AUTONOMY');
  }

  /**
   * Evalúa si una acción puede proceder según el nivel de autonomía y guardian gates.
   * @param {string} action - Nombre de la acción (ej: 'pre-code', 'pre-merge')
   * @param {object} context - Contexto de la operación (filesChanged, task, plan, etc.)
   * @returns {Promise<{ allowed: boolean, reasons: string[], approval: object|null }>}
   */
  async checkGate(action, context = {}) {
    const gateResults = guardianGates.evaluate(context);
    const triggered = gateResults.filter(r => r.triggered);
    const reasons = triggered.map(r => r.reason);

    eventBus.emit('autonomy:gate-check', {
      action,
      level: this.#level,
      gatesTriggered: triggered.map(r => r.gate),
      reasons,
    });

    // AUTONOMOUS: always allow, just log
    if (this.#level === AUTONOMY_LEVELS.AUTONOMOUS) {
      if (triggered.length) {
        logger.info(`Autonomous mode — gates triggered but proceeding: ${reasons.join('; ')}`, 'AUTONOMY');
      }
      return { allowed: true, reasons, approval: null };
    }

    // GUARDIAN: auto-block if critical gates triggered, no human approval
    if (this.#level === AUTONOMY_LEVELS.GUARDIAN) {
      if (triggered.length) {
        logger.warn(`Guardian mode — auto-blocking action '${action}': ${reasons.join('; ')}`, 'AUTONOMY');
        return { allowed: false, reasons, approval: null };
      }
      return { allowed: true, reasons: [], approval: null };
    }

    // SUPERVISED: always require approval
    if (this.#level === AUTONOMY_LEVELS.SUPERVISED) {
      const approval = await approvalGate.waitForApproval({ action, context, reasons: reasons.length ? reasons : ['Supervised mode requires approval for all actions'] });
      return { allowed: approval.approved, reasons, approval };
    }

    // SEMI_AUTONOMOUS: only require approval if gates triggered
    if (triggered.length) {
      const approval = await approvalGate.waitForApproval({ action, context, reasons });
      return { allowed: approval.approved, reasons, approval };
    }

    return { allowed: true, reasons: [], approval: null };
  }

  /**
   * Cambia el nivel de autonomía en runtime.
   */
  setLevel(level) {
    const resolved = this.#resolveLevel(level);
    const previous = this.#level;
    this.#level = resolved;
    logger.info(`Autonomy level changed: ${previous} → ${resolved}`, 'AUTONOMY');
    eventBus.emit('autonomy:level-changed', { previous, current: resolved });
  }

  getLevel() {
    return this.#level;
  }

  #resolveLevel(level) {
    if (VALID_LEVELS.has(level)) return level;
    logger.warn(`Invalid autonomy level '${level}', defaulting to semi-autonomous`, 'AUTONOMY');
    return AUTONOMY_LEVELS.SEMI_AUTONOMOUS;
  }
}

export { AutonomyEngine };
export const autonomyEngine = new AutonomyEngine();
