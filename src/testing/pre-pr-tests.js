import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Auto-detects the test command for a project and runs it.
 * @param {string} cwd
 * @returns {{ passed: boolean, command: string, output: string, exitCode: number }}
 */
export function runPrePrTests(cwd) {
  const command = detectTestCommand(cwd);
  if (!command) {
    logger.warn('No test command detected — skipping pre-PR tests', 'PRE_PR_TESTS');
    return { passed: true, command: null, output: '', exitCode: 0 };
  }

  logger.info(`Running pre-PR tests: ${command}`, 'PRE_PR_TESTS');

  const [cmd, ...args] = command.split(' ');
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    timeout: 300_000,
  });

  const output = [result.stdout?.toString(), result.stderr?.toString()].filter(Boolean).join('\n');
  const passed = result.status === 0;

  if (passed) {
    logger.success('Pre-PR tests PASSED', 'PRE_PR_TESTS');
  } else {
    logger.warn(`Pre-PR tests FAILED (exit ${result.status})`, 'PRE_PR_TESTS');
  }

  return { passed, command, output, exitCode: result.status ?? 1 };
}

function detectTestCommand(cwd) {
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};

      if (scripts.test) return 'npm test';
      if (scripts['test:unit']) return 'npm run test:unit';
      if (scripts.vitest) return 'npx vitest run';
    } catch { /* ignore */ }
  }

  // Check for common test runners
  if (existsSync(join(cwd, 'vitest.config.js')) || existsSync(join(cwd, 'vitest.config.ts'))) {
    return 'npx vitest run';
  }
  if (existsSync(join(cwd, 'jest.config.js')) || existsSync(join(cwd, 'jest.config.ts'))) {
    return 'npx jest';
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    return 'cargo test';
  }

  return null;
}
