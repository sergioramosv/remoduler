/**
 * Model Selector — selects the optimal model per role and complexity.
 */

/**
 * Force overrides: roles that always use a specific model regardless of complexity.
 * Can be extended via TRIAGE_FORCE_MODELS env var (JSON).
 */
export const FORCE_MODELS = {
  SECURITY: 'claude',
  ...parseForceModels(),
};

function parseForceModels() {
  try {
    return JSON.parse(process.env.TRIAGE_FORCE_MODELS || '{}');
  } catch {
    return {};
  }
}

/**
 * Model matrix: complexity × role → model.
 */
export const MODEL_MAPS = {
  trivial: {
    PLANNER: 'claude',
    ARCHITECT: 'claude',
    CODER: 'claude',
    TESTER: 'claude',
    SECURITY: 'claude',
    REVIEWER: 'claude',
  },
  standard: {
    PLANNER: 'claude',
    ARCHITECT: 'claude',
    CODER: 'claude',
    TESTER: 'claude',
    SECURITY: 'claude',
    REVIEWER: 'claude',
  },
  complex: {
    PLANNER: 'claude',
    ARCHITECT: 'claude',
    CODER: 'claude',
    TESTER: 'claude',
    SECURITY: 'claude',
    REVIEWER: 'claude',
  },
};

/**
 * Selects the best model for a given role and complexity level.
 * @param {string} role - Agent role (PLANNER, CODER, etc.)
 * @param {string} complexity - Complexity level (trivial, standard, complex)
 * @returns {string} Model name
 */
export function selectModel(role, complexity) {
  // Check force overrides first
  if (FORCE_MODELS[role]) {
    return FORCE_MODELS[role];
  }

  // Consult the model map
  const map = MODEL_MAPS[complexity];
  if (map && map[role]) {
    return map[role];
  }

  // Fallback
  return 'claude';
}
