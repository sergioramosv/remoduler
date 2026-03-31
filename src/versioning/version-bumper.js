import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Reads package.json version and bumps it.
 * @param {string} cwd
 * @param {'patch'|'minor'|'major'} type
 * @returns {{ oldVersion: string, newVersion: string }}
 */
export function bumpVersion(cwd, type = 'patch') {
  const pkgPath = join(cwd, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version || '0.0.0';

  const [major, minor, patch] = oldVersion.split('.').map(Number);

  let newVersion;
  switch (type) {
    case 'major': newVersion = `${major + 1}.0.0`; break;
    case 'minor': newVersion = `${major}.${minor + 1}.0`; break;
    case 'patch': newVersion = `${major}.${minor}.${patch + 1}`; break;
    default: throw new Error(`Unknown bump type: ${type}`);
  }

  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  logger.info(`Version bumped: ${oldVersion} → ${newVersion} (${type})`, 'VERSION_BUMPER');

  return { oldVersion, newVersion };
}

/**
 * Reads the current version from package.json.
 * @param {string} cwd
 * @returns {string}
 */
export function getCurrentVersion(cwd) {
  const pkgPath = join(cwd, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version || '0.0.0';
}
