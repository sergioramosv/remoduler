import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Scheduler — parses HH:MM-HH:MM schedule windows and determines
 * if the current time falls within the allowed execution window.
 */
export class Scheduler {
  #startHour = null;
  #startMinute = null;
  #endHour = null;
  #endMinute = null;
  #timezone = 'UTC';
  #hasWindow = false;

  constructor(windowStr, timezone) {
    this.#timezone = timezone || config.daemonTimezone || 'UTC';
    if (windowStr) {
      this.#parse(windowStr);
    }
  }

  /**
   * Parse a schedule window string like "09:00-17:00" or "22:00-06:00".
   */
  #parse(windowStr) {
    const match = windowStr.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) {
      logger.warn(`Invalid schedule window format: "${windowStr}" — expected HH:MM-HH:MM`, 'SCHEDULER');
      return;
    }

    const [, sh, sm, eh, em] = match;
    this.#startHour = parseInt(sh, 10);
    this.#startMinute = parseInt(sm, 10);
    this.#endHour = parseInt(eh, 10);
    this.#endMinute = parseInt(em, 10);

    if (this.#startHour > 23 || this.#endHour > 23 || this.#startMinute > 59 || this.#endMinute > 59) {
      logger.warn(`Invalid schedule window values: "${windowStr}"`, 'SCHEDULER');
      this.#startHour = null;
      return;
    }

    this.#hasWindow = true;
    logger.info(`Schedule window set: ${windowStr} (${this.#timezone})`, 'SCHEDULER');
  }

  /**
   * Returns the current hour and minute in the configured timezone.
   */
  #getNow() {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.#timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    return { hour, minute };
  }

  /**
   * Converts hour:minute to total minutes since midnight.
   */
  #toMinutes(hour, minute) {
    return hour * 60 + minute;
  }

  /**
   * Returns true if current time is within the schedule window.
   * If no window is configured, always returns true.
   */
  isInScheduleWindow() {
    if (!this.#hasWindow) return true;

    const { hour, minute } = this.#getNow();
    const now = this.#toMinutes(hour, minute);
    const start = this.#toMinutes(this.#startHour, this.#startMinute);
    const end = this.#toMinutes(this.#endHour, this.#endMinute);

    // Normal window (e.g., 09:00-17:00)
    if (start <= end) {
      return now >= start && now < end;
    }

    // Overnight window (e.g., 22:00-06:00)
    return now >= start || now < end;
  }

  /**
   * Returns the configured window info for logging/debugging.
   */
  getWindowInfo() {
    if (!this.#hasWindow) return { active: false, window: null, timezone: this.#timezone };
    const pad = (n) => String(n).padStart(2, '0');
    return {
      active: true,
      window: `${pad(this.#startHour)}:${pad(this.#startMinute)}-${pad(this.#endHour)}:${pad(this.#endMinute)}`,
      timezone: this.#timezone,
    };
  }
}

export const scheduler = new Scheduler(config.daemonScheduleWindow, config.daemonTimezone);
