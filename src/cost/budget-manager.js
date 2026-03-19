import { getDb } from '../firebase.js';
import { eventBus } from '../events/event-bus.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * BudgetManager — gestiona presupuesto diario/semanal de tokens.
 * Trackea gasto, detecta excesos, emite warnings, persiste en Firebase.
 */
class BudgetManager {
  #projectId = null;
  #daily = { date: '', spent: 0 };
  #weekly = { weekStart: '', spent: 0 };
  #initialized = false;
  #warningEmitted = { daily: false, weekly: false };
  #exceededEmitted = { daily: false, weekly: false };

  get initialized() {
    return this.#initialized;
  }

  /**
   * Inicializa leyendo estado desde Firebase. Resetea si cambió el día/semana.
   */
  async initialize(projectId) {
    this.#projectId = projectId;

    try {
      const snapshot = await getDb()
        .ref(`budgets/${projectId}`)
        .once('value');

      const data = snapshot.val();
      const today = this.#getToday();
      const currentWeekStart = this.#getWeekStart();

      if (data?.daily && data.daily.date === today) {
        this.#daily = { ...data.daily };
      } else {
        this.#daily = { date: today, spent: 0 };
      }

      if (data?.weekly && data.weekly.weekStart === currentWeekStart) {
        this.#weekly = { ...data.weekly };
      } else {
        this.#weekly = { weekStart: currentWeekStart, spent: 0 };
      }

      this.#warningEmitted = { daily: false, weekly: false };
      this.#exceededEmitted = { daily: false, weekly: false };
      this.#initialized = true;

      await this.#persist();

      logger.info(
        `Budget initialized — Daily: $${this.#daily.spent.toFixed(2)}/$${config.dailyBudgetUsd} | Weekly: $${this.#weekly.spent.toFixed(2)}/$${config.weeklyBudgetUsd}`,
        'BUDGET',
      );
    } catch (error) {
      logger.error(`Budget initialization failed: ${error.message}`, 'BUDGET');
      this.#daily = { date: this.#getToday(), spent: 0 };
      this.#weekly = { weekStart: this.#getWeekStart(), spent: 0 };
      this.#initialized = true;
    }
  }

  /**
   * Registra un gasto. Persiste a Firebase y emite eventos si corresponde.
   */
  async addCost(amount) {
    if (!amount || amount <= 0) return;

    this.#daily.spent += amount;
    this.#weekly.spent += amount;

    await this.#persist();
    this.#checkThresholds();
  }

  /**
   * Retorna true si el presupuesto diario O semanal está excedido.
   */
  isExceeded() {
    return (
      this.#daily.spent >= config.dailyBudgetUsd ||
      this.#weekly.spent >= config.weeklyBudgetUsd
    );
  }

  /**
   * Retorna estado actual del presupuesto.
   */
  getStatus() {
    return {
      daily: {
        spent: this.#daily.spent,
        limit: config.dailyBudgetUsd,
        remaining: Math.max(0, config.dailyBudgetUsd - this.#daily.spent),
        percentage: config.dailyBudgetUsd > 0
          ? this.#daily.spent / config.dailyBudgetUsd
          : 0,
      },
      weekly: {
        spent: this.#weekly.spent,
        limit: config.weeklyBudgetUsd,
        remaining: Math.max(0, config.weeklyBudgetUsd - this.#weekly.spent),
        percentage: config.weeklyBudgetUsd > 0
          ? this.#weekly.spent / config.weeklyBudgetUsd
          : 0,
      },
    };
  }

  #checkThresholds() {
    const threshold = config.budgetWarningThreshold;

    // Daily checks
    if (!this.#exceededEmitted.daily && this.#daily.spent >= config.dailyBudgetUsd) {
      this.#exceededEmitted.daily = true;
      const data = { type: 'daily', spent: this.#daily.spent, limit: config.dailyBudgetUsd };
      eventBus.emit('budget:exceeded', data);
      logger.warn(`Daily budget EXCEEDED: $${this.#daily.spent.toFixed(2)}/$${config.dailyBudgetUsd}`, 'BUDGET');
    } else if (!this.#warningEmitted.daily && this.#daily.spent >= threshold * config.dailyBudgetUsd) {
      this.#warningEmitted.daily = true;
      const data = { type: 'daily', spent: this.#daily.spent, limit: config.dailyBudgetUsd, threshold };
      eventBus.emit('budget:warning', data);
      logger.warn(`Daily budget at ${(this.#daily.spent / config.dailyBudgetUsd * 100).toFixed(0)}%: $${this.#daily.spent.toFixed(2)}/$${config.dailyBudgetUsd}`, 'BUDGET');
    }

    // Weekly checks
    if (!this.#exceededEmitted.weekly && this.#weekly.spent >= config.weeklyBudgetUsd) {
      this.#exceededEmitted.weekly = true;
      const data = { type: 'weekly', spent: this.#weekly.spent, limit: config.weeklyBudgetUsd };
      eventBus.emit('budget:exceeded', data);
      logger.warn(`Weekly budget EXCEEDED: $${this.#weekly.spent.toFixed(2)}/$${config.weeklyBudgetUsd}`, 'BUDGET');
    } else if (!this.#warningEmitted.weekly && this.#weekly.spent >= threshold * config.weeklyBudgetUsd) {
      this.#warningEmitted.weekly = true;
      const data = { type: 'weekly', spent: this.#weekly.spent, limit: config.weeklyBudgetUsd, threshold };
      eventBus.emit('budget:warning', data);
      logger.warn(`Weekly budget at ${(this.#weekly.spent / config.weeklyBudgetUsd * 100).toFixed(0)}%: $${this.#weekly.spent.toFixed(2)}/$${config.weeklyBudgetUsd}`, 'BUDGET');
    }
  }

  async #persist() {
    if (!this.#projectId) return;

    try {
      await getDb()
        .ref(`budgets/${this.#projectId}`)
        .set({
          daily: { ...this.#daily },
          weekly: { ...this.#weekly },
        });
    } catch (error) {
      logger.error(`Budget persist failed: ${error.message}`, 'BUDGET');
    }
  }

  #getToday() {
    return new Date().toISOString().split('T')[0];
  }

  #getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday = start of week
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return monday.toISOString().split('T')[0];
  }
}

export { BudgetManager };
export const budgetManager = new BudgetManager();
