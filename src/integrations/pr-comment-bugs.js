import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { getDb } from '../firebase.js';

const POLL_INTERVAL_MS = parseInt(process.env.PR_COMMENT_POLL_MS || String(3 * 60 * 1000)); // 3 min
const TRIGGER_PATTERN = /^@komodo\s+bug:\s*(.+)/im;

let intervalId = null;
const processedComments = new Set();

/**
 * Polls PR comments for @komodo bug: mentions and creates bugs.
 * @param {string} projectId
 * @param {string} cwd
 */
export function startPrCommentWatch(projectId, cwd) {
  if (intervalId) return;
  logger.info(`PR comment bug watch started (interval: ${POLL_INTERVAL_MS}ms)`, 'PR_COMMENT_BUGS');
  intervalId = setInterval(() => pollComments(projectId, cwd), POLL_INTERVAL_MS);
  pollComments(projectId, cwd);
}

export function stopPrCommentWatch() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('PR comment watch stopped', 'PR_COMMENT_BUGS');
  }
}

async function pollComments(projectId, cwd) {
  try {
    const shell = process.platform === 'win32';
    const prsOut = execSync(
      'gh pr list --state open --json number --limit 20',
      { cwd, stdio: 'pipe', shell }
    ).toString();

    const prs = JSON.parse(prsOut);

    for (const pr of prs) {
      const commentsOut = execSync(
        `gh pr view ${pr.number} --json comments --jq '.comments[]'`,
        { cwd, stdio: 'pipe', shell }
      ).toString();

      if (!commentsOut.trim()) continue;

      const comments = commentsOut.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

      for (const comment of comments) {
        const key = `${pr.number}-${comment.id || comment.databaseId}`;
        if (processedComments.has(key)) continue;
        processedComments.add(key);

        const match = TRIGGER_PATTERN.exec(comment.body || '');
        if (match) {
          const bugTitle = match[1].trim();
          await createBug(projectId, bugTitle, pr.number, comment);
        }
      }
    }
  } catch (err) {
    logger.error(`PR comment poll failed: ${err.message}`, 'PR_COMMENT_BUGS');
  }
}

async function createBug(projectId, title, prNumber, comment) {
  const db = getDb();
  const bugRef = db.ref(`planning/${projectId}/bugs`).push();
  await bugRef.set({
    title: `[PR#${prNumber}] ${title}`,
    description: `Reported via PR comment by @${comment.author?.login || 'unknown'}`,
    status: 'to-do',
    severity: 'medium',
    projectId,
    createdAt: Date.now(),
    createdBy: 'remoduler:pr-comment',
    prNumber,
  });
  logger.info(`Bug created from PR#${prNumber} comment: ${title}`, 'PR_COMMENT_BUGS');
}
