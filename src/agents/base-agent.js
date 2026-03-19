import { spawnAgent } from '../spawn-agent.js';
import { parseResult, parseResultAsJson } from '../parse-result.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';
import { resolve } from 'node:path';

/**
 * BaseAgent — clase base para todos los agentes.
 * Encapsula: spawn CLI + MCP injection + parse + logging + eventos.
 *
 * Uso:
 *   const agent = new BaseAgent({
 *     name: 'PLANNER',
 *     cli: 'claude',
 *     systemPrompt: '...',
 *     mcpServers: ['planning-task-mcp'],
 *     maxTurns: 15,
 *     timeout: 180000,
 *   });
 *   const result = await agent.run(userPrompt);
 */
export class BaseAgent {
  #name;
  #cli;
  #systemPrompt;
  #mcpServerNames;
  #maxTurns;
  #timeout;
  #reviewerMode;
  #parseAsJson;

  constructor({
    name,
    cli = 'claude',
    systemPrompt = '',
    mcpServers = [],
    maxTurns = 10,
    timeout = 120000,
    reviewerMode = false,
    parseAsJson = true,
  }) {
    this.#name = name;
    this.#cli = cli;
    this.#systemPrompt = systemPrompt;
    this.#mcpServerNames = mcpServers;
    this.#maxTurns = maxTurns;
    this.#timeout = timeout;
    this.#reviewerMode = reviewerMode;
    this.#parseAsJson = parseAsJson;
  }

  get name() { return this.#name; }

  /**
   * Ejecuta el agente con un prompt de usuario.
   * Devuelve resultado estandarizado.
   */
  async run(userPrompt) {
    const startTime = Date.now();

    logger.info(`Starting...`, this.#name);
    eventBus.emit('agent:start', { agent: this.#name });

    // Build full prompt: system + user
    const fullPrompt = this.#systemPrompt
      ? `${this.#systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    // Build MCP server configs
    const mcpServers = this.#mcpServerNames.length > 0
      ? this.#buildMcpServers()
      : undefined;

    try {
      const raw = await spawnAgent(this.#cli, fullPrompt, {
        shell: true,
        timeout: this.#timeout,
        mcpServers,
        maxTurns: this.#maxTurns,
        agentName: this.#name,
        reviewerMode: this.#reviewerMode,
      });

      const duration = Date.now() - startTime;

      // Rate limited?
      if (raw.rateLimited) {
        logger.warn(`Rate limited`, this.#name);
        eventBus.emit('agent:done', { agent: this.#name, success: false, rateLimited: true });
        return {
          success: false,
          rateLimited: true,
          error: 'Rate limited',
          duration,
        };
      }

      // Early terminated by watchdog?
      if (raw.earlyTerminated) {
        logger.warn(`Early terminated: ${raw.terminationReason}`, this.#name);
        eventBus.emit('agent:done', { agent: this.#name, success: false, earlyTerminated: true });
        return {
          success: false,
          earlyTerminated: true,
          terminationReason: raw.terminationReason,
          duration,
        };
      }

      // Parse output
      const parsed = this.#parseAsJson
        ? parseResultAsJson(raw.stdout)
        : parseResult(raw.stdout);

      if (!parsed.success) {
        logger.error(`Parse failed: ${parsed.error}`, this.#name);
        eventBus.emit('agent:done', { agent: this.#name, success: false });
        return {
          success: false,
          error: parsed.error,
          raw: parsed.raw,
          stderr: raw.stderr?.slice(0, 500),
          duration,
        };
      }

      const tokens = parsed.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

      const costEur = (parsed.cost * 0.92).toFixed(4); // USD → EUR approx
      logger.success(
        `Done (${costEur}€ / $${parsed.cost?.toFixed(4)} | ${tokens.total.toLocaleString()} tokens | ${parsed.turns} turns | ${(duration / 1000).toFixed(1)}s)`,
        this.#name,
      );
      eventBus.emit('agent:done', {
        agent: this.#name,
        success: true,
        cost: parsed.cost,
        turns: parsed.turns,
        tokens,
      });

      return {
        success: true,
        result: parsed.result,
        data: parsed.data ?? null,
        cost: parsed.cost,
        turns: parsed.turns,
        tokens,
        duration,
        isFallback: raw.isFallback,
        effectiveCli: raw.effectiveCli,
      };

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`Error: ${err.message}`, this.#name);
      eventBus.emit('agent:done', { agent: this.#name, success: false, error: err.message });
      return {
        success: false,
        error: err.message,
        duration,
      };
    }
  }

  /**
   * Construye las definiciones de MCP servers para inyectar en el CLI.
   */
  #buildMcpServers() {
    const skillsDir = resolve(process.cwd(), 'skills');
    const servers = {};

    for (const name of this.#mcpServerNames) {
      if (name === 'planning-task-mcp') {
        servers[name] = {
          command: 'node',
          args: [resolve(skillsDir, name, 'src', 'index.js')],
          env: {
            GOOGLE_APPLICATION_CREDENTIALS: resolve(skillsDir, name, 'serviceAccountKey.json'),
            FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || '',
            DEFAULT_USER_ID: process.env.DEFAULT_USER_ID || '',
            DEFAULT_USER_NAME: process.env.DEFAULT_USER_NAME || '',
          },
        };
      } else if (name === 'github-mcp') {
        servers[name] = {
          command: 'node',
          args: [resolve(skillsDir, name, 'src', 'index.js')],
        };
      }
    }

    return Object.keys(servers).length > 0 ? servers : undefined;
  }
}
