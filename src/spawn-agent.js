import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkAndEmitRateLimit } from './agents/rate-limit-detector.js';
import { fallbackManager } from './agents/fallback-manager.js';
import { StreamingWatchdog } from './agents/streaming-watchdog.js';

/**
 * Spawna un CLI de IA y le envia un prompt por stdin.
 * Integra: rate limit detection, fallback, streaming watchdog.
 */
export function spawnAgent(cli, prompt, options = {}) {
  const {
    timeout = 60000,
    args = [],
    mcpServers,
    maxTurns = 10,
    agentName = 'UNKNOWN',
    watchdog: watchdogEnabled = true,
    reviewerMode = false,
  } = options;

  // 1. Resolve effective CLI (fallback si rate-limited)
  const { cli: effectiveCli, isFallback } = fallbackManager.resolveEffectiveCli(cli, agentName);

  const finalArgs = args.length > 0 ? args : buildArgs(effectiveCli, { maxTurns });

  const mcpConfigPath = mcpServers ? writeMcpConfig(mcpServers) : null;
  if (mcpConfigPath) {
    finalArgs.push('--mcp-config', mcpConfigPath);
  }

  // 2. Create watchdog
  const watchdog = watchdogEnabled
    ? new StreamingWatchdog(agentName, { reviewerMode })
    : null;

  return new Promise((resolve, reject) => {
    const proc = spawn(effectiveCli, finalArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: options.shell ?? false,
    });

    let stdout = '';
    let stderr = '';
    let rateLimited = false;
    let earlyTerminated = false;

    // Wire watchdog kill to process kill
    if (watchdog) {
      watchdog.onKill(() => {
        earlyTerminated = true;
        proc.kill();
      });
    }

    // 3. Feed stdout to watchdog + check rate limits
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;

      if (watchdog) watchdog.feed(text);
    });

    // 4. Check stderr for rate limits
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;

      if (checkAndEmitRateLimit(text, effectiveCli, agentName)) {
        rateLimited = true;
        fallbackManager.markRateLimited(effectiveCli);
      }
    });

    const timer = setTimeout(() => {
      proc.kill();
      cleanup();
      reject(new Error(`Timeout after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      cleanup();

      // 5. Check stdout for rate limits too
      if (!rateLimited && checkAndEmitRateLimit(stdout, effectiveCli, agentName)) {
        rateLimited = true;
        fallbackManager.markRateLimited(effectiveCli);
      }

      resolve({
        code,
        stdout,
        stderr,
        rateLimited,
        earlyTerminated,
        terminationReason: watchdog?.terminationReason ?? null,
        isFallback,
        effectiveCli,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    function cleanup() {
      if (mcpConfigPath) {
        try { unlinkSync(mcpConfigPath); } catch {}
      }
    }
  });
}

function buildArgs(cli, { maxTurns } = {}) {
  if (cli === 'claude') {
    return ['--output-format', 'json', '--max-turns', String(maxTurns)];
  }
  return [];
}

function writeMcpConfig(servers) {
  const config = { mcpServers: servers };
  const filename = `remoduler-mcp-${Date.now()}.json`;
  const filepath = join(tmpdir(), filename);
  writeFileSync(filepath, JSON.stringify(config, null, 2));
  return filepath;
}
