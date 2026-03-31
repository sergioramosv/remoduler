import { getDb } from '../firebase.js';
import { logger } from '../utils/logger.js';

/**
 * Creates tasks for minor review issues that don't block but should be addressed.
 * @param {string} projectId
 * @param {string[]} issues - List of minor issue descriptions
 * @returns {Promise<number>} Number of tasks created
 */
export async function trackTechDebt(projectId, issues) {
  if (!issues?.length) return 0;

  const db = getDb();
  let created = 0;

  for (const issue of issues) {
    try {
      const taskRef = db.ref(`planning/${projectId}/tasks`).push();
      await taskRef.set({
        title: `[Tech Debt] ${issue}`,
        status: 'to-do',
        priority: 0.5,
        type: 'tech-debt',
        projectId,
        createdAt: Date.now(),
        createdBy: 'remoduler',
        decomposed: false,
        devPoints: 1,
        bizPoints: 1,
      });
      created++;
      logger.info(`Tech debt task created: ${issue}`, 'TECH_DEBT');
    } catch (err) {
      logger.error(`Failed to create tech debt task: ${err.message}`, 'TECH_DEBT');
    }
  }

  logger.info(`Created ${created} tech debt tasks`, 'TECH_DEBT');
  return created;
}
