import { logger } from '../utils/logger.js';
import { loadProjects } from './project-loader.js';

const STRATEGIES = ['round-robin', 'priority', 'backlog-size'];

/**
 * MultiProjectRunner — orchestrates task execution across multiple projects.
 */
export class MultiProjectRunner {
  #projects = [];
  #strategy = 'round-robin';
  #roundRobinIndex = 0;

  /**
   * @param {'round-robin'|'priority'|'backlog-size'} strategy
   */
  constructor(strategy = 'round-robin') {
    if (!STRATEGIES.includes(strategy)) throw new Error(`Unknown strategy: ${strategy}. Use: ${STRATEGIES.join(', ')}`);
    this.#strategy = strategy;
    this.#projects = loadProjects();
  }

  get projectCount() { return this.#projects.length; }

  /**
   * Returns the next project to run based on strategy.
   * @param {Map<string, number>} [backlogSizes] - projectId → pending task count (for backlog-size strategy)
   * @returns {{ projectId: string, cwd: string } | null}
   */
  next(backlogSizes = new Map()) {
    if (this.#projects.length === 0) return null;

    switch (this.#strategy) {
      case 'round-robin':
        return this.#roundRobin();
      case 'priority':
        return this.#byPriority();
      case 'backlog-size':
        return this.#byBacklogSize(backlogSizes);
    }
  }

  #roundRobin() {
    const project = this.#projects[this.#roundRobinIndex % this.#projects.length];
    this.#roundRobinIndex++;
    logger.info(`Round-robin: selected ${project.name}`, 'MULTI_PROJECT');
    return project;
  }

  #byPriority() {
    const sorted = [...this.#projects].sort((a, b) => b.priority - a.priority);
    logger.info(`Priority: selected ${sorted[0].name} (priority ${sorted[0].priority})`, 'MULTI_PROJECT');
    return sorted[0];
  }

  #byBacklogSize(backlogSizes) {
    const sorted = [...this.#projects].sort((a, b) => {
      const sizeA = backlogSizes.get(a.projectId) ?? 0;
      const sizeB = backlogSizes.get(b.projectId) ?? 0;
      return sizeB - sizeA;
    });
    logger.info(`Backlog-size: selected ${sorted[0].name} (${backlogSizes.get(sorted[0].projectId) ?? 0} tasks)`, 'MULTI_PROJECT');
    return sorted[0];
  }

  getProjects() {
    return [...this.#projects];
  }
}

export const multiProjectRunner = new MultiProjectRunner(
  process.env.MULTI_PROJECT_STRATEGY || 'round-robin'
);
