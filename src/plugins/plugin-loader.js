import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import { validatePlugin } from './plugin-interface.js';

const PLUGINS_DIR = process.env.PLUGINS_DIR || '.remoduler/plugins';

/**
 * Loads all plugins from PLUGINS_DIR.
 * Each plugin file/directory must export { name, version, hooks }.
 * @returns {Promise<object[]>} Loaded and validated plugins
 */
export async function loadPlugins() {
  const pluginsPath = resolve(PLUGINS_DIR);

  let entries;
  try {
    entries = readdirSync(pluginsPath);
  } catch {
    logger.info(`No plugins directory found at ${pluginsPath}`, 'PLUGIN_LOADER');
    return [];
  }

  const plugins = [];

  for (const entry of entries) {
    const fullPath = join(pluginsPath, entry);
    const stat = statSync(fullPath);

    let pluginPath;
    if (stat.isDirectory()) {
      pluginPath = join(fullPath, 'index.js');
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      pluginPath = fullPath;
    } else {
      continue;
    }

    try {
      const plugin = await import(pluginPath);
      const exported = plugin.default || plugin;

      const { valid, errors } = validatePlugin(exported);
      if (!valid) {
        logger.warn(`Plugin ${entry} invalid: ${errors.join(', ')}`, 'PLUGIN_LOADER');
        continue;
      }

      plugins.push(exported);
      logger.info(`Plugin loaded: ${exported.name} v${exported.version}`, 'PLUGIN_LOADER');
    } catch (err) {
      logger.error(`Failed to load plugin ${entry}: ${err.message}`, 'PLUGIN_LOADER');
    }
  }

  logger.info(`${plugins.length} plugin(s) loaded`, 'PLUGIN_LOADER');
  return plugins;
}

/**
 * Runs a specific hook across all plugins and returns aggregated issues.
 * Issues are tagged as MANDATORY to be injected into review.
 * @param {object[]} plugins
 * @param {'before-review'|'after-code'} hookName
 * @param {object} context
 * @returns {Promise<object[]>} Aggregated issues with mandatory flag
 */
export async function runHook(plugins, hookName, context) {
  const allIssues = [];

  for (const plugin of plugins) {
    if (!plugin.hooks?.[hookName]) continue;

    try {
      const issues = await plugin.hooks[hookName](context);
      if (Array.isArray(issues)) {
        for (const issue of issues) {
          allIssues.push({ ...issue, source: plugin.name, mandatory: true });
        }
      }
    } catch (err) {
      logger.error(`Plugin ${plugin.name} hook ${hookName} failed: ${err.message}`, 'PLUGIN_LOADER');
    }
  }

  return allIssues;
}
