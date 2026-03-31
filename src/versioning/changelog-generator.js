import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Generates a CHANGELOG.md entry for a version.
 * @param {string} cwd
 * @param {string} version
 * @param {{ features: string[], fixes: string[], breaking: string[] }} changes
 */
export function generateChangelog(cwd, version, changes = {}) {
  const changelogPath = join(cwd, 'CHANGELOG.md');
  const date = new Date().toISOString().split('T')[0];

  const sections = [];

  if (changes.breaking?.length) {
    sections.push('### Breaking Changes\n' + changes.breaking.map(c => `- ${c}`).join('\n'));
  }
  if (changes.features?.length) {
    sections.push('### Features\n' + changes.features.map(c => `- ${c}`).join('\n'));
  }
  if (changes.fixes?.length) {
    sections.push('### Bug Fixes\n' + changes.fixes.map(c => `- ${c}`).join('\n'));
  }

  if (sections.length === 0) {
    sections.push('### Changes\n- Maintenance update');
  }

  const entry = `## [${version}] - ${date}\n\n${sections.join('\n\n')}\n`;

  let existing = '';
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, 'utf8');
  }

  const header = '# Changelog\n\n';
  const content = existing.startsWith('# Changelog')
    ? existing.replace('# Changelog\n\n', header + entry + '\n')
    : header + entry + '\n' + existing;

  writeFileSync(changelogPath, content);
  logger.info(`CHANGELOG.md updated for v${version}`, 'CHANGELOG');

  return entry;
}
