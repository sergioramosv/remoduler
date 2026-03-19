/**
 * Complexity Classifier — classifies tasks as trivial/standard/complex.
 */

export const COMPLEXITY_LEVELS = {
  TRIVIAL: 'trivial',
  STANDARD: 'standard',
  COMPLEX: 'complex',
};

const COMPLEX_KEYWORDS = [
  'refactor', 'migration', 'security', 'integration',
  'authentication', 'authorization', 'database', 'performance',
  'architecture', 'infrastructure',
];

/**
 * Classifies a task's complexity based on devPoints, acceptance criteria count,
 * and keywords in title/description.
 * @param {{ devPoints?: number, acceptanceCriteria?: string[], title?: string, description?: string }} taskSpec
 * @returns {{ level: string, reasons: string[], score: number }}
 */
export function classifyComplexity(taskSpec) {
  const { devPoints = 1, acceptanceCriteria = [], title = '', description = '' } = taskSpec;
  const reasons = [];
  let score = 0;

  // Base score from devPoints
  score += devPoints;
  if (devPoints <= 2) {
    reasons.push(`Low devPoints (${devPoints})`);
  } else if (devPoints <= 5) {
    reasons.push(`Moderate devPoints (${devPoints})`);
  } else {
    reasons.push(`High devPoints (${devPoints})`);
  }

  // Adjust by acceptance criteria count
  const criteriaCount = acceptanceCriteria.length;
  if (criteriaCount > 5) {
    score += 2;
    reasons.push(`Many acceptance criteria (${criteriaCount})`);
  } else if (criteriaCount > 3) {
    score += 1;
    reasons.push(`Moderate acceptance criteria (${criteriaCount})`);
  }

  // Adjust by keywords in title + description
  const text = `${title} ${description}`.toLowerCase();
  const matchedKeywords = COMPLEX_KEYWORDS.filter(kw => text.includes(kw));
  if (matchedKeywords.length > 0) {
    score += matchedKeywords.length;
    reasons.push(`Complex keywords: ${matchedKeywords.join(', ')}`);
  }

  // Determine level from final score
  let level;
  if (score <= 2) {
    level = COMPLEXITY_LEVELS.TRIVIAL;
  } else if (score <= 5) {
    level = COMPLEXITY_LEVELS.STANDARD;
  } else {
    level = COMPLEXITY_LEVELS.COMPLEX;
  }

  return { level, reasons, score };
}
