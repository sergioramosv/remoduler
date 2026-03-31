import { spawnSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

const CHECK_INTERVAL_MS = parseInt(process.env.DEPENDENCY_CHECK_INTERVAL_MS || String(24 * 60 * 60 * 1000)); // 24h
let intervalId = null;

/**
 * Runs npm audit + npm outdated and returns a report.
 * @param {string} cwd
 * @returns {{ vulnerabilities: object, outdated: object, hasIssues: boolean }}
 */
export function checkDependencies(cwd) {
  logger.info('Checking dependencies (audit + outdated)...', 'DEP_CHECKER');
  const shell = process.platform === 'win32';

  const auditResult = spawnSync('npm', ['audit', '--json'], { cwd, stdio: 'pipe', shell });
  let vulnerabilities = {};
  try {
    const auditData = JSON.parse(auditResult.stdout?.toString() || '{}');
    vulnerabilities = auditData.metadata?.vulnerabilities || {};
  } catch { /* ignore parse errors */ }

  const outdatedResult = spawnSync('npm', ['outdated', '--json'], { cwd, stdio: 'pipe', shell });
  let outdated = {};
  try {
    outdated = JSON.parse(outdatedResult.stdout?.toString() || '{}');
  } catch { /* ignore */ }

  const totalVulns = Object.values(vulnerabilities).reduce((sum, count) => sum + (count || 0), 0);
  const outdatedCount = Object.keys(outdated).length;
  const hasIssues = totalVulns > 0 || outdatedCount > 0;

  if (hasIssues) {
    logger.warn(`Dependencies: ${totalVulns} vulnerabilities, ${outdatedCount} outdated packages`, 'DEP_CHECKER');
    eventBus.emit('dependencies:issues', { vulnerabilities, outdated, totalVulns, outdatedCount });
  } else {
    logger.success('Dependencies are clean', 'DEP_CHECKER');
  }

  return { vulnerabilities, outdated, hasIssues };
}

/**
 * Start periodic dependency checks every 24h.
 * @param {string} cwd
 */
export function startPeriodicCheck(cwd) {
  if (intervalId) return;
  logger.info(`Starting periodic dependency check every ${CHECK_INTERVAL_MS / 3600000}h`, 'DEP_CHECKER');
  intervalId = setInterval(() => checkDependencies(cwd), CHECK_INTERVAL_MS);
  checkDependencies(cwd);
}

export function stopPeriodicCheck() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
