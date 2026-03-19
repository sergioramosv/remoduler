import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

/**
 * Monitorea el stream de un agente en tiempo real para detectar anomalías.
 * Se alimenta con feed() por cada línea de stdout.
 */
export class StreamingWatchdog {
  #agentName;
  #reviewerMode;
  #terminated = false;
  #terminationReason = null;
  #killCallback = null;

  // Counters
  #totalChars = 0;
  #lastToolName = null;
  #consecutiveSameToolCount = 0;
  #consecutiveToolsWithoutText = 0;
  #charsSinceLastCodeBlock = 0;
  #charsSinceLastToolCall = 0;

  constructor(agentName, options = {}) {
    this.#agentName = agentName;
    this.#reviewerMode = options.reviewerMode || false;
  }

  get terminated() { return this.#terminated; }
  get terminationReason() { return this.#terminationReason; }

  onKill(callback) {
    this.#killCallback = callback;
  }

  feed(text) {
    if (this.#terminated || !text) return;

    this.#totalChars += text.length;

    // 1. Reviewer early approval (primeros 3K chars)
    if (this.#reviewerMode && this.#totalChars < 3000) {
      if (/"(?:verdict|decision)"\s*:\s*"APPROVED"/i.test(text)) {
        this.#kill('REVIEWER_EARLY_APPROVED', 'Reviewer approved early');
        return;
      }
    }

    // 2. Tool loop (5+ misma tool consecutiva)
    const toolMatch = text.match(/"(?:tool_name|name)"\s*:\s*"([^"]+)"/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      this.#charsSinceLastToolCall = 0;
      this.#consecutiveToolsWithoutText++;

      if (toolName === this.#lastToolName) {
        this.#consecutiveSameToolCount++;
        if (this.#consecutiveSameToolCount >= 5) {
          this.#kill('TOOL_LOOP', `Tool "${toolName}" called 5+ times in a row`);
          return;
        }
      } else {
        this.#lastToolName = toolName;
        this.#consecutiveSameToolCount = 1;
      }
    } else {
      this.#consecutiveToolsWithoutText = 0;
    }

    // 3. Excessive tool calls (20+ without text)
    if (this.#consecutiveToolsWithoutText >= 20) {
      this.#kill('EXCESSIVE_TOOLS', '20+ tool calls without text output');
      return;
    }

    // 4. Code block tracking
    if (text.includes('```')) {
      this.#charsSinceLastCodeBlock = 0;
    } else {
      this.#charsSinceLastCodeBlock += text.length;
    }

    // 5. Wandering (5K+ chars sin code block, solo para CODER)
    if (this.#agentName === 'CODER' && this.#charsSinceLastCodeBlock > 5000) {
      this.#kill('WANDERING', '5K+ chars without code block');
      return;
    }

    // 6. No access detector
    if (/(?:cannot|can't|don't have)\s+access/i.test(text)) {
      this.#kill('NO_ACCESS', 'Agent reports no access');
      return;
    }

    this.#charsSinceLastToolCall += text.length;
  }

  #kill(reason, description) {
    this.#terminated = true;
    this.#terminationReason = reason;

    logger.warn(`[WATCHDOG:${this.#agentName}] ${reason}: ${description}`, this.#agentName);

    eventBus.emit('watchdog:kill', {
      agent: this.#agentName, reason, description,
    });

    this.#killCallback?.();
  }
}
