import { logger } from '../utils/logger.js';

/**
 * Loads project configs from PROJECTS env variable.
 * Format: JSON array of { projectId, cwd, priority? }
 * Example: PROJECTS=[{"projectId":"abc","cwd":"/repos/foo","priority":2}]
 */
export function loadProjects() {
  const raw = process.env.PROJECTS;
  if (!raw) {
    logger.warn('PROJECTS env not set — multi-project mode disabled', 'PROJECT_LOADER');
    return [];
  }

  try {
    const projects = JSON.parse(raw);
    if (!Array.isArray(projects)) throw new Error('PROJECTS must be a JSON array');

    const valid = projects.filter(p => {
      if (!p.projectId) { logger.warn(`Project missing projectId, skipping`, 'PROJECT_LOADER'); return false; }
      if (!p.cwd) { logger.warn(`Project ${p.projectId} missing cwd, skipping`, 'PROJECT_LOADER'); return false; }
      return true;
    }).map(p => ({
      projectId: p.projectId,
      cwd: p.cwd,
      priority: p.priority ?? 1,
      name: p.name || p.projectId,
    }));

    logger.info(`Loaded ${valid.length} projects`, 'PROJECT_LOADER');
    return valid;
  } catch (err) {
    logger.error(`Failed to parse PROJECTS env: ${err.message}`, 'PROJECT_LOADER');
    return [];
  }
}
