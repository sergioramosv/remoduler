import { eventBus } from '../events/event-bus.js';

const CLAUDE_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /usage.?limit/i,
  /quota.?exceeded/i,
  /overloaded/i,
  /at capacity/i,
  /hit your.*limit/i,
];

const CODEX_PATTERNS = [
  /rate_limit_exceeded/i,
  /tokens?.?per.?min/i,
  /requests?.?per.?min/i,
  ...CLAUDE_PATTERNS,
];

const GEMINI_PATTERNS = [
  /resource_exhausted/i,
  /RESOURCE_EXHAUSTED/,
  ...CLAUDE_PATTERNS,
];

const CLI_PATTERNS = {
  claude: CLAUDE_PATTERNS,
  codex: CODEX_PATTERNS,
  gemini: GEMINI_PATTERNS,
};

/**
 * Detecta rate limit en texto de output/stderr de un CLI.
 */
export function detectRateLimit(text, cli = 'claude') {
  if (!text) return { detected: false, matchedPattern: null };

  const patterns = CLI_PATTERNS[cli] || CLAUDE_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return { detected: true, matchedPattern: pattern.source };
    }
  }
  return { detected: false, matchedPattern: null };
}

/**
 * Extrae retry-after en segundos del texto.
 */
export function parseRetryAfter(text) {
  if (!text) return null;

  // "retry after 2m30s"
  const compound = text.match(/retry.*?(\d+)m(\d+)s/i);
  if (compound) return parseInt(compound[1]) * 60 + parseInt(compound[2]);

  // "retry after 22s" / "wait 60s"
  const secs = text.match(/(?:retry|wait).*?(\d+)\s*s(?:econds?)?/i);
  if (secs) return parseInt(secs[1]);

  // "retry in 5 minutes"
  const mins = text.match(/(?:retry|wait).*?(\d+)\s*min/i);
  if (mins) return parseInt(mins[1]) * 60;

  // "Retry-After: 120"
  const header = text.match(/retry-after:\s*(\d+)/i);
  if (header) return parseInt(header[1]);

  return null;
}

/**
 * Punto de integración: detecta rate limit y emite evento.
 */
export function checkAndEmitRateLimit(text, cli, agentName) {
  const { detected, matchedPattern } = detectRateLimit(text, cli);
  if (!detected) return false;

  const retryAfterSeconds = parseRetryAfter(text);

  eventBus.emit('rate-limit:detected', {
    cli, agentName, matchedPattern, retryAfterSeconds,
  });

  return true;
}
