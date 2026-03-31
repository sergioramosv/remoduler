import { logger } from '../utils/logger.js';

/**
 * Verifies there are no blocking bugs before allowing a release.
 * @param {object[]} bugs - Array of bug objects with { severity, status }
 * @returns {{ canRelease: boolean, blockingBugs: object[] }}
 */
export function checkReleaseGate(bugs = []) {
  const BLOCKING_SEVERITIES = ['critical', 'blocker'];

  const blockingBugs = bugs.filter(b =>
    BLOCKING_SEVERITIES.includes(b.severity?.toLowerCase()) &&
    b.status !== 'done' &&
    b.status !== 'validated'
  );

  if (blockingBugs.length > 0) {
    logger.warn(
      `Release BLOCKED: ${blockingBugs.length} critical/blocker bug(s) open: ${blockingBugs.map(b => b.title || b.id).join(', ')}`,
      'RELEASE_GATE'
    );
    return { canRelease: false, blockingBugs };
  }

  logger.success('Release gate PASSED — no blocking bugs', 'RELEASE_GATE');
  return { canRelease: true, blockingBugs: [] };
}
