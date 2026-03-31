import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

/**
 * Detects merge conflicts between a branch and a target branch.
 * @param {string} cwd
 * @param {string} sourceBranch
 * @param {string} targetBranch
 * @returns {{ hasConflicts: boolean, files: string[] }}
 */
export function detectConflicts(cwd, sourceBranch, targetBranch = 'main') {
  const shell = process.platform === 'win32';

  try {
    execSync(`git fetch origin ${targetBranch}`, { cwd, stdio: 'pipe', shell });

    // Dry-run merge to detect conflicts
    const mergeBase = execSync(
      `git merge-base ${sourceBranch} origin/${targetBranch}`,
      { cwd, stdio: 'pipe', shell }
    ).toString().trim();

    const result = execSync(
      `git merge-tree ${mergeBase} ${sourceBranch} origin/${targetBranch}`,
      { cwd, stdio: 'pipe', shell }
    ).toString();

    const conflictFiles = [];
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.includes('<<<<<<< ') || line.startsWith('CONFLICT')) {
        const fileMatch = line.match(/CONFLICT.*:\s+(.+)/);
        if (fileMatch) conflictFiles.push(fileMatch[1].trim());
      }
    }

    if (conflictFiles.length > 0) {
      logger.warn(`Conflicts detected in: ${conflictFiles.join(', ')}`, 'CONFLICT_DETECTOR');
    } else {
      logger.info(`No conflicts detected between ${sourceBranch} and ${targetBranch}`, 'CONFLICT_DETECTOR');
    }

    return { hasConflicts: conflictFiles.length > 0, files: conflictFiles };
  } catch (err) {
    logger.error(`Conflict detection failed: ${err.message}`, 'CONFLICT_DETECTOR');
    return { hasConflicts: false, files: [] };
  }
}
