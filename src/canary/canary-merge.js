import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { detectConflicts } from './conflict-detector.js';
import { ciMonitor } from '../ci-monitor/ci-monitor.js';

const STAGING_BRANCH = process.env.CANARY_STAGING_BRANCH || 'staging';
const MAIN_BRANCH = process.env.CANARY_MAIN_BRANCH || 'main';
const STABILITY_WAIT_MS = parseInt(process.env.CANARY_STABILITY_WAIT_MS || '120000'); // 2 min

const shell = process.platform === 'win32';

/**
 * Canary merge strategy:
 * 1. Check conflicts
 * 2. Merge source → staging
 * 3. Wait for CI stability
 * 4. Promote staging → main
 *
 * @param {string} cwd
 * @param {string} sourceBranch
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
export async function canaryMerge(cwd, sourceBranch) {
  logger.info(`Canary merge: ${sourceBranch} → ${STAGING_BRANCH} → ${MAIN_BRANCH}`, 'CANARY');

  const { hasConflicts, files } = detectConflicts(cwd, sourceBranch, MAIN_BRANCH);
  if (hasConflicts) {
    logger.warn(`Canary blocked: conflicts in ${files.join(', ')}`, 'CANARY');
    return { success: false, reason: `Conflicts: ${files.join(', ')}` };
  }

  try {
    // Step 1: merge to staging
    logger.info(`Merging ${sourceBranch} → ${STAGING_BRANCH}...`, 'CANARY');
    execSync(`git checkout ${STAGING_BRANCH}`, { cwd, stdio: 'pipe', shell });
    execSync(`git merge ${sourceBranch} --no-ff -m "canary: ${sourceBranch}"`, { cwd, stdio: 'pipe', shell });
    execSync(`git push origin ${STAGING_BRANCH}`, { cwd, stdio: 'pipe', shell });
    eventBus.emit('canary:stagedMerged', { sourceBranch, stagingBranch: STAGING_BRANCH });

    // Step 2: wait for CI on staging
    logger.info(`Waiting ${STABILITY_WAIT_MS}ms for CI stability on ${STAGING_BRANCH}...`, 'CANARY');
    const ciResult = await waitForCi(cwd, STAGING_BRANCH);
    if (!ciResult) {
      logger.warn('Canary: staging CI failed — not promoting to main', 'CANARY');
      return { success: false, reason: 'Staging CI failed' };
    }

    // Step 3: promote to main
    logger.info(`Promoting ${STAGING_BRANCH} → ${MAIN_BRANCH}...`, 'CANARY');
    execSync(`git checkout ${MAIN_BRANCH}`, { cwd, stdio: 'pipe', shell });
    execSync(`git merge ${STAGING_BRANCH} --no-ff -m "promote: ${sourceBranch}"`, { cwd, stdio: 'pipe', shell });
    execSync(`git push origin ${MAIN_BRANCH}`, { cwd, stdio: 'pipe', shell });

    logger.success(`Canary merge complete: ${sourceBranch} → ${MAIN_BRANCH}`, 'CANARY');
    eventBus.emit('canary:promoted', { sourceBranch, mainBranch: MAIN_BRANCH });
    return { success: true };
  } catch (err) {
    logger.error(`Canary merge failed: ${err.message}`, 'CANARY');
    return { success: false, reason: err.message };
  }
}

function waitForCi(cwd, branch) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      ciMonitor.stop();
      resolve(false);
    }, STABILITY_WAIT_MS + 60_000);

    eventBus.once('ci:success', () => { clearTimeout(timeout); resolve(true); });
    eventBus.once('ci:failure', () => { clearTimeout(timeout); resolve(false); });

    ciMonitor.start(cwd, branch);
  });
}
