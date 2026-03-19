import { getDb } from '../firebase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const SYNC_THRESHOLD = config.intelligenceSyncThreshold ?? 0.6;

export function calculateSimilarity(patternsA, patternsB) {
  if (!patternsA?.length || !patternsB?.length) return 0;

  const setA = new Set(patternsA.flatMap(p => p.fileTypes || []));
  const setB = new Set(patternsB.flatMap(p => p.fileTypes || []));

  if (setA.size === 0 && setB.size === 0) return 0;

  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;

  return union === 0 ? 0 : intersection / union;
}

export async function syncPatterns(sourceProjectId, targetProjectId) {
  try {
    const db = getDb();
    const [sourceSnap, targetSnap] = await Promise.all([
      db.ref(`intelligence/${sourceProjectId}/patterns`).once('value'),
      db.ref(`intelligence/${targetProjectId}/patterns`).once('value'),
    ]);

    const sourcePatterns = sourceSnap.val() || [];
    const targetPatterns = targetSnap.val() || [];

    const sourcePatternsArr = Array.isArray(sourcePatterns) ? sourcePatterns : [];
    const targetPatternsArr = Array.isArray(targetPatterns) ? targetPatterns : [];

    const similarity = calculateSimilarity(sourcePatternsArr, targetPatternsArr);

    if (similarity < SYNC_THRESHOLD) {
      logger.info(
        `Similarity ${similarity.toFixed(2)} below threshold ${SYNC_THRESHOLD} — skipping sync`,
        'INTELLIGENCE',
      );
      return { synced: false, similarity };
    }

    const merged = mergePatterns(sourcePatternsArr, targetPatternsArr);
    await db.ref(`intelligence/${targetProjectId}/patterns`).set(merged);

    logger.info(
      `Synced patterns from ${sourceProjectId} to ${targetProjectId} (similarity: ${similarity.toFixed(2)})`,
      'INTELLIGENCE',
    );
    return { synced: true, similarity, mergedCount: merged.length };
  } catch (err) {
    logger.error(`Failed to sync patterns: ${err.message}`, 'INTELLIGENCE');
    return { synced: false, similarity: 0 };
  }
}

function mergePatterns(source, target) {
  const existing = new Set(target.map(p => p.learnedAt));
  const newPatterns = source.filter(p => !existing.has(p.learnedAt));
  return [...target, ...newPatterns];
}
