import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';
import { execSync } from 'node:child_process';

/**
 * Cuando un CLI está rate-limited, redirige al siguiente CLI disponible.
 */
class FallbackManager {
  #rateLimitedMap = new Map(); // cli → timestamp

  isEnabled() {
    return config.rateLimitFallback;
  }

  markRateLimited(cli) {
    this.#rateLimitedMap.set(cli, Date.now());
  }

  isRateLimited(cli) {
    const ts = this.#rateLimitedMap.get(cli);
    if (!ts) return false;

    const cooldownMs = config.rateLimitCooldownMinutes * 60 * 1000;
    if (Date.now() - ts > cooldownMs) {
      this.#rateLimitedMap.delete(cli);
      return false;
    }
    return true;
  }

  getAvailableFallback(failedCli) {
    for (const cli of config.fallbackCliOrder) {
      if (cli === failedCli) continue;
      if (this.isRateLimited(cli)) continue;
      if (!this.#cliExists(cli)) continue;
      return cli;
    }
    return null;
  }

  /**
   * Resuelve qué CLI usar. Si el original está rate-limited, intenta fallback.
   */
  resolveEffectiveCli(originalCli, agentName) {
    if (!this.isEnabled()) return { cli: originalCli, isFallback: false };
    if (!this.isRateLimited(originalCli)) return { cli: originalCli, isFallback: false };

    const fallback = this.getAvailableFallback(originalCli);
    if (fallback) {
      eventBus.emit('agent:fallback', { agent: agentName, from: originalCli, to: fallback });
      return { cli: fallback, isFallback: true };
    }

    return { cli: originalCli, isFallback: false };
  }

  markRecovered(cli) {
    this.#rateLimitedMap.delete(cli);
  }

  clear() {
    this.#rateLimitedMap.clear();
  }

  getRateLimitedClis() {
    // Auto-clean expired
    for (const [cli] of this.#rateLimitedMap) this.isRateLimited(cli);
    return [...this.#rateLimitedMap.keys()];
  }

  #cliExists(cmd) {
    try {
      execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }
}

export const fallbackManager = new FallbackManager();
