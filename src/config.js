import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

// Cargar .env aquí para garantizar que process.env está listo antes del objeto config
dotenv.config({ quiet: true });

/**
 * Config loader. Lee de process.env (cargado por dotenv).
 */
export const config = {
  // Agent CLIs
  cliPlanner: process.env.CLI_PLANNER || 'claude',
  cliCoder: process.env.CLI_CODER || 'claude',
  cliReviewer: process.env.CLI_REVIEWER || 'claude',
  cliArchitect: process.env.CLI_ARCHITECT || 'claude',

  // Firebase
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || '',
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  defaultUserId: process.env.DEFAULT_USER_ID || '',
  defaultUserName: process.env.DEFAULT_USER_NAME || '',
  defaultProjectId: process.env.DEFAULT_PROJECT_ID || '',

  // GitHub
  githubToken: process.env.GITHUB_TOKEN || '',

  // Servers
  wsPort: parseInt(process.env.WS_PORT || '3001'),
  apiPort: parseInt(process.env.API_PORT || '3002'),

  // Review
  maxReviewCycles: parseInt(process.env.MAX_REVIEW_CYCLES || '3'),
  autoMerge: process.env.AUTO_MERGE !== 'false',

  // Budget
  dailyBudgetUsd: parseFloat(process.env.DAILY_BUDGET_USD || '10'),
  weeklyBudgetUsd: parseFloat(process.env.WEEKLY_BUDGET_USD || '50'),
  budgetWarningThreshold: parseFloat(process.env.BUDGET_WARNING_THRESHOLD || '0.8'),

  // Rate limit
  rateLimitFallback: process.env.RATE_LIMIT_FALLBACK !== 'false',
  fallbackCliOrder: (process.env.FALLBACK_CLI_ORDER || 'claude,codex,gemini').split(','),
  rateLimitCooldownMinutes: parseInt(process.env.RATE_LIMIT_COOLDOWN_MINUTES || '15'),

  // Triage
  triageEpsilon: parseFloat(process.env.TRIAGE_EPSILON || '0.1'),
  triageDecomposeThreshold: parseInt(process.env.TRIAGE_DECOMPOSE_THRESHOLD || '5'),
  triageForceModels: parseJson(process.env.TRIAGE_FORCE_MODELS, {}),

  // Intelligence
  intelligenceCacheTtl: parseInt(process.env.INTELLIGENCE_CACHE_TTL || '300000'),
  intelligenceMaxChars: parseInt(process.env.INTELLIGENCE_MAX_CHARS || '2000'),
  intelligenceDecayFactor: parseFloat(process.env.INTELLIGENCE_DECAY_FACTOR || '0.95'),
  intelligenceSyncThreshold: parseFloat(process.env.INTELLIGENCE_SYNC_THRESHOLD || '0.6'),
};

export function validateConfig() {
  const issues = [];

  if (!cliExists(config.cliPlanner)) issues.push(`CLI '${config.cliPlanner}' not found`);
  if (!cliExists(config.cliCoder)) issues.push(`CLI '${config.cliCoder}' not found`);
  if (!config.firebaseDatabaseUrl) issues.push('FIREBASE_DATABASE_URL not set');
  if (!config.defaultProjectId) issues.push('DEFAULT_PROJECT_ID not set');

  return { valid: issues.length === 0, issues };
}

function parseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function cliExists(cmd) {
  try {
    execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
