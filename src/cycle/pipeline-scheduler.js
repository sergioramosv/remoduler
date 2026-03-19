import { logger } from '../utils/logger.js';

/**
 * Ejecuta agentes en paralelo o secuencial según configuración.
 * QA + Security + Tester pueden correr en paralelo.
 * Reviewer SIEMPRE es secuencial.
 *
 * @param {Array} agents - [{ name, execute, parallel }]
 * @returns {object} results - { agentName: result }
 */
export async function runParallelAgents(agents) {
  const results = {};

  const parallel = agents.filter(a => a.parallel);
  const sequential = agents.filter(a => !a.parallel);

  // Run parallel group
  if (parallel.length > 0) {
    logger.info(`Running ${parallel.length} agents in parallel: ${parallel.map(a => a.name).join(', ')}`);

    const promises = parallel.map(agent =>
      agent.execute()
        .then(r => { results[agent.name] = r; })
        .catch(err => {
          logger.error(`${agent.name} failed: ${err.message}`);
          results[agent.name] = { success: false, error: err.message };
        })
    );
    await Promise.all(promises);
  }

  // Run sequential group
  for (const agent of sequential) {
    logger.info(`Running ${agent.name} (sequential)`);
    try {
      results[agent.name] = await agent.execute();
    } catch (err) {
      logger.error(`${agent.name} failed: ${err.message}`);
      results[agent.name] = { success: false, error: err.message };
    }
  }

  return results;
}
