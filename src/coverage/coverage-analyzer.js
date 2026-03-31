import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

const MIN_COVERAGE_DELTA = parseFloat(process.env.MIN_COVERAGE_DELTA || '-5'); // allow up to 5% drop
const BASELINE_FILE = '.remoduler/coverage-baseline.json';

/**
 * Reads coverage from a coverage-summary.json file (Istanbul/NYC/Vitest format).
 * @param {string} cwd
 * @returns {number | null} Coverage percentage or null if not found
 */
function readCoverage(cwd) {
  const paths = [
    join(cwd, 'coverage/coverage-summary.json'),
    join(cwd, 'coverage-summary.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf8'));
        return data.total?.lines?.pct ?? data.total?.statements?.pct ?? null;
      } catch { /* continue */ }
    }
  }
  return null;
}

/**
 * Records current coverage as baseline.
 * @param {string} cwd
 * @param {number} coverage
 */
export function recordBaseline(cwd, coverage) {
  const path = join(cwd, BASELINE_FILE);
  const dir = path.substring(0, path.lastIndexOf('/'));

  try {
    if (!existsSync(dir)) {
      require('node:fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify({ coverage, recordedAt: new Date().toISOString() }));
    logger.info(`Coverage baseline recorded: ${coverage}%`, 'COVERAGE');
  } catch (err) {
    logger.warn(`Failed to record baseline: ${err.message}`, 'COVERAGE');
  }
}

/**
 * Checks coverage delta vs baseline. Blocks if delta exceeds MIN_COVERAGE_DELTA.
 * @param {string} cwd
 * @returns {{ passed: boolean, current: number | null, baseline: number | null, delta: number | null, blocked: boolean }}
 */
export function analyzeCoverage(cwd) {
  const current = readCoverage(cwd);

  if (current === null) {
    logger.warn('No coverage report found — skipping coverage check', 'COVERAGE');
    return { passed: true, current: null, baseline: null, delta: null, blocked: false };
  }

  const baselinePath = join(cwd, BASELINE_FILE);
  let baseline = null;

  if (existsSync(baselinePath)) {
    try {
      const data = JSON.parse(readFileSync(baselinePath, 'utf8'));
      baseline = data.coverage;
    } catch { /* no baseline */ }
  }

  if (baseline === null) {
    logger.info(`No baseline found. Recording current coverage: ${current}%`, 'COVERAGE');
    recordBaseline(cwd, current);
    return { passed: true, current, baseline: null, delta: null, blocked: false };
  }

  const delta = current - baseline;
  const blocked = delta < MIN_COVERAGE_DELTA;

  if (blocked) {
    logger.warn(`Coverage dropped ${delta.toFixed(2)}% (${baseline}% → ${current}%) — below threshold ${MIN_COVERAGE_DELTA}%`, 'COVERAGE');
  } else {
    logger.info(`Coverage delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% (${baseline}% → ${current}%)`, 'COVERAGE');
  }

  return { passed: !blocked, current, baseline, delta, blocked };
}
