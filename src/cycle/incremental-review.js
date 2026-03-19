import { execSync } from 'node:child_process';

/**
 * Construye contexto incremental para reviews en ciclo 2+.
 * Solo envía al reviewer el diff desde su último review, ahorrando ~40-60% tokens.
 */
export function buildIncrementalContext(lastReviewSHA, currentSHA, fullDiff, cwd) {
  if (!lastReviewSHA) {
    return { diff: fullDiff, isIncremental: false };
  }

  try {
    const diff = execSync(
      `git diff ${lastReviewSHA}..${currentSHA}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, cwd }
    );

    const fullLen = fullDiff.length || 1;
    const saved = fullLen - diff.length;

    return {
      diff,
      isIncremental: true,
      tokensSaved: Math.ceil(saved / 4),
      reductionPercent: Math.round((saved / fullLen) * 100),
    };
  } catch {
    // Si falla el git diff incremental, caer al diff completo
    return { diff: fullDiff, isIncremental: false };
  }
}
