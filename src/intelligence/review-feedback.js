import { getDb } from '../firebase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const DECAY_FACTOR = config.intelligenceDecayFactor ?? 0.95;

export async function recordIssue(projectId, issue) {
  try {
    const key = sanitizeKey(issue.type || 'unknown');
    const ref = getDb().ref(`intelligence/${projectId}/review-issues/${key}`);
    const snapshot = await ref.once('value');
    const existing = snapshot.val();

    const updated = {
      type: issue.type || 'unknown',
      message: issue.message || '',
      count: (existing?.count || 0) + 1,
      lastSeen: new Date().toISOString(),
    };

    await ref.set(updated);
    logger.info(`Recorded review issue '${updated.type}' for project ${projectId}`, 'INTELLIGENCE');
    return updated;
  } catch (err) {
    logger.error(`Failed to record issue: ${err.message}`, 'INTELLIGENCE');
    return null;
  }
}

export async function getTopIssues(projectId, limit = 5) {
  try {
    const snapshot = await getDb().ref(`intelligence/${projectId}/review-issues`).once('value');
    const data = snapshot.val();
    if (!data) return [];

    const now = Date.now();
    const issues = Object.values(data).map(issue => {
      const daysSince = (now - new Date(issue.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
      const effectiveScore = issue.count * Math.pow(DECAY_FACTOR, daysSince);
      return { ...issue, effectiveScore };
    });

    issues.sort((a, b) => b.effectiveScore - a.effectiveScore);
    return issues.slice(0, limit);
  } catch (err) {
    logger.error(`Failed to get top issues: ${err.message}`, 'INTELLIGENCE');
    return [];
  }
}

function sanitizeKey(str) {
  return str.replace(/[.#$/\[\]]/g, '_');
}
