import { getDb } from '../firebase.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

const MAX_PROPOSALS = 5;

/**
 * Suggests improvements when the backlog is empty.
 * Emits 'autoImprove:suggestions' event with up to MAX_PROPOSALS proposals.
 * @param {string} projectId
 * @param {string} cwd
 * @returns {Promise<string[]>} Proposal list
 */
export async function suggestImprovements(projectId, cwd) {
  const backlogSize = await getBacklogSize(projectId);

  if (backlogSize > 0) {
    logger.info(`Backlog has ${backlogSize} tasks — auto-improve skipped`, 'AUTO_IMPROVE');
    return [];
  }

  logger.info('Backlog empty — generating improvement suggestions...', 'AUTO_IMPROVE');

  const proposals = await generateProposals(cwd);
  const limited = proposals.slice(0, MAX_PROPOSALS);

  if (limited.length > 0) {
    logger.info(`Auto-improve: ${limited.length} proposals generated`, 'AUTO_IMPROVE');
    eventBus.emit('autoImprove:suggestions', { projectId, proposals: limited });
  }

  return limited;
}

async function getBacklogSize(projectId) {
  try {
    const db = getDb();
    const snap = await db.ref(`planning/${projectId}/tasks`)
      .orderByChild('status')
      .equalTo('to-do')
      .once('value');
    return snap.numChildren();
  } catch {
    return 1; // assume non-empty on error
  }
}

async function generateProposals(cwd) {
  const { analyzeCodebase } = await import('../tech-debt/codebase-analyzer.js');
  const { checkDependencies } = await import('../tech-debt/dependency-checker.js');

  const proposals = [];

  try {
    const { unusedImports, potentialDeadCode } = analyzeCodebase(cwd);
    if (unusedImports.length > 0) proposals.push(`Remove ${unusedImports.length} unused imports`);
    if (potentialDeadCode.length > 0) proposals.push(`Clean up ${potentialDeadCode.length} potentially unused exports`);
  } catch { /* ignore */ }

  try {
    const { vulnerabilities, outdatedCount } = checkDependencies(cwd);
    const vulnCount = Object.values(vulnerabilities).reduce((s, c) => s + (c || 0), 0);
    if (vulnCount > 0) proposals.push(`Fix ${vulnCount} dependency vulnerabilities`);
    if (outdatedCount > 0) proposals.push(`Update ${outdatedCount} outdated packages`);
  } catch { /* ignore */ }

  proposals.push('Add integration tests for critical paths');
  proposals.push('Improve error handling coverage');
  proposals.push('Add JSDoc to public API functions');

  return proposals;
}
