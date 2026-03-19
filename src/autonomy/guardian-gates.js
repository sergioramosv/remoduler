import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const SECURITY_PATTERNS = ['.env', 'auth', 'secret', 'credential', 'token', 'key', 'password'];
const MIGRATION_PATTERNS = ['migration', 'migrate', 'schema'];
const DEPS_FILES = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

/**
 * GuardianGates — triggers dinámicos que detectan operaciones riesgosas.
 * Cada gate recibe contexto y retorna { gate, triggered, reason }.
 */
class GuardianGates {
  /**
   * Evalúa todos los gates contra el contexto dado.
   * @param {object} context - { filesChanged, diffLines, cycles }
   * @returns {{ gate: string, triggered: boolean, reason: string }[]}
   */
  evaluate(context = {}) {
    const results = [
      this.#diffSizeGate(context),
      this.#securityFilesGate(context),
      this.#reviewCyclesGate(context),
      this.#dbMigrationGate(context),
      this.#depsChangedGate(context),
    ];

    const triggered = results.filter(r => r.triggered);
    if (triggered.length) {
      logger.warn(`Guardian gates triggered: ${triggered.map(r => r.gate).join(', ')}`, 'AUTONOMY');
    }

    return results;
  }

  #diffSizeGate({ filesChanged, diffLines }) {
    const count = diffLines ?? (filesChanged?.length ?? 0);
    const threshold = config.autonomyDiffThreshold;
    const triggered = count > threshold;
    return {
      gate: 'diffSize',
      triggered,
      reason: triggered ? `Diff size (${count}) exceeds threshold (${threshold})` : '',
    };
  }

  #securityFilesGate({ filesChanged }) {
    if (!filesChanged?.length) return { gate: 'securityFiles', triggered: false, reason: '' };
    const matched = filesChanged.filter(f => {
      const lower = f.toLowerCase();
      return SECURITY_PATTERNS.some(p => lower.includes(p));
    });
    const triggered = matched.length > 0;
    return {
      gate: 'securityFiles',
      triggered,
      reason: triggered ? `Security-sensitive files modified: ${matched.join(', ')}` : '',
    };
  }

  #reviewCyclesGate({ cycles }) {
    const threshold = config.autonomyMaxCyclesThreshold;
    const triggered = (cycles || 0) > threshold;
    return {
      gate: 'reviewCycles',
      triggered,
      reason: triggered ? `Review cycles (${cycles}) exceed threshold (${threshold})` : '',
    };
  }

  #dbMigrationGate({ filesChanged }) {
    if (!filesChanged?.length) return { gate: 'dbMigration', triggered: false, reason: '' };
    const matched = filesChanged.filter(f => {
      const lower = f.toLowerCase();
      return MIGRATION_PATTERNS.some(p => lower.includes(p));
    });
    const triggered = matched.length > 0;
    return {
      gate: 'dbMigration',
      triggered,
      reason: triggered ? `DB migration files detected: ${matched.join(', ')}` : '',
    };
  }

  #depsChangedGate({ filesChanged }) {
    if (!filesChanged?.length) return { gate: 'depsChanged', triggered: false, reason: '' };
    const matched = filesChanged.filter(f => {
      const basename = f.split('/').pop();
      return DEPS_FILES.includes(basename);
    });
    const triggered = matched.length > 0;
    return {
      gate: 'depsChanged',
      triggered,
      reason: triggered ? `Dependency files changed: ${matched.join(', ')}` : '',
    };
  }
}

export { GuardianGates };
export const guardianGates = new GuardianGates();
