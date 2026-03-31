/**
 * Plugin Interface — defines the contract for Remoduler plugins.
 *
 * A plugin must export:
 * {
 *   name: string,
 *   version: string,
 *   hooks: {
 *     'before-review'?: (context: ReviewContext) => Promise<Issue[]> | Issue[],
 *     'after-code'?:   (context: CodeContext)   => Promise<Issue[]> | Issue[],
 *   }
 * }
 *
 * Issue shape: { message: string, severity: 'info'|'warn'|'error', file?: string, line?: number }
 */

/**
 * @typedef {{ taskId: string, taskTitle: string, files: string[], cwd: string }} ReviewContext
 * @typedef {{ taskId: string, taskTitle: string, changedFiles: string[], cwd: string }} CodeContext
 * @typedef {{ message: string, severity: 'info'|'warn'|'error', file?: string, line?: number }} Issue
 */

export const HOOK_NAMES = ['before-review', 'after-code'];

/**
 * Validates that a plugin object conforms to the interface.
 * @param {object} plugin
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlugin(plugin) {
  const errors = [];

  if (!plugin.name || typeof plugin.name !== 'string') errors.push('Missing or invalid plugin.name');
  if (!plugin.version || typeof plugin.version !== 'string') errors.push('Missing or invalid plugin.version');
  if (!plugin.hooks || typeof plugin.hooks !== 'object') errors.push('Missing or invalid plugin.hooks');

  if (plugin.hooks) {
    for (const hookName of Object.keys(plugin.hooks)) {
      if (!HOOK_NAMES.includes(hookName)) {
        errors.push(`Unknown hook: ${hookName}. Valid hooks: ${HOOK_NAMES.join(', ')}`);
      }
      if (typeof plugin.hooks[hookName] !== 'function') {
        errors.push(`Hook ${hookName} must be a function`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
