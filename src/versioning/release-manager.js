import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/event-bus.js';

const shell = process.platform === 'win32';

/**
 * Creates a GitHub Release via the gh CLI.
 * @param {string} cwd
 * @param {string} version
 * @param {string} changelogEntry - Markdown content for the release notes
 * @param {{ prerelease?: boolean, draft?: boolean }} [opts]
 * @returns {{ url: string }}
 */
export async function createRelease(cwd, version, changelogEntry, opts = {}) {
  const tag = `v${version}`;
  logger.info(`Creating GitHub release ${tag}...`, 'RELEASE_MANAGER');

  try {
    // Tag the commit
    execSync(`git tag ${tag}`, { cwd, stdio: 'pipe', shell });
    execSync(`git push origin ${tag}`, { cwd, stdio: 'pipe', shell });

    // Build gh release command
    const flags = [
      `--title "${tag}"`,
      `--notes "${changelogEntry.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      opts.prerelease ? '--prerelease' : '',
      opts.draft ? '--draft' : '',
    ].filter(Boolean).join(' ');

    const output = execSync(
      `gh release create ${tag} ${flags}`,
      { cwd, stdio: 'pipe', shell }
    ).toString().trim();

    logger.success(`Release created: ${output}`, 'RELEASE_MANAGER');
    eventBus.emit('release:created', { version, tag, url: output });

    return { url: output };
  } catch (err) {
    logger.error(`Release creation failed: ${err.message}`, 'RELEASE_MANAGER');
    throw err;
  }
}
