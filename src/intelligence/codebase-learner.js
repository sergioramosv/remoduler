import { getDb } from '../firebase.js';
import { logger } from '../utils/logger.js';

export async function learnFromTask(projectId, taskResult) {
  try {
    const pattern = extractPattern(taskResult);
    const ref = getDb().ref(`intelligence/${projectId}/patterns`);
    const snapshot = await ref.once('value');
    const existing = snapshot.val() || [];

    const patterns = Array.isArray(existing) ? existing : [];
    patterns.push(pattern);

    await ref.set(patterns);
    logger.info(`Learned pattern from task in project ${projectId}`, 'INTELLIGENCE');
    return pattern;
  } catch (err) {
    logger.error(`Failed to learn from task: ${err.message}`, 'INTELLIGENCE');
    return null;
  }
}

export async function getLearnedPatterns(projectId) {
  try {
    const snapshot = await getDb().ref(`intelligence/${projectId}/patterns`).once('value');
    const data = snapshot.val();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.error(`Failed to get learned patterns: ${err.message}`, 'INTELLIGENCE');
    return [];
  }
}

export async function clearPatterns(projectId) {
  try {
    await getDb().ref(`intelligence/${projectId}/patterns`).set(null);
    logger.info(`Cleared patterns for project ${projectId}`, 'INTELLIGENCE');
  } catch (err) {
    logger.error(`Failed to clear patterns: ${err.message}`, 'INTELLIGENCE');
  }
}

function extractPattern(taskResult) {
  const {
    filesCreated = [],
    filesModified = [],
    testPattern = null,
    branchNaming = null,
    devPoints = 0,
  } = taskResult || {};

  const fileTypes = [...new Set(
    [...filesCreated, ...filesModified]
      .map(f => {
        const ext = f.split('.').pop();
        return ext || 'unknown';
      })
  )];

  return {
    filesCreated: filesCreated.length,
    filesModified: filesModified.length,
    fileTypes,
    testPattern,
    branchNaming,
    avgDevPoints: devPoints,
    learnedAt: new Date().toISOString(),
  };
}
