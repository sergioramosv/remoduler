import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { getDb } from '../firebase.js';

const POLL_INTERVAL_MS = parseInt(process.env.GITHUB_ISSUE_POLL_MS || String(5 * 60 * 1000)); // 5 min
const ISSUE_LABEL = process.env.GITHUB_ISSUE_LABEL || 'komodo';

let intervalId = null;
const syncedIssues = new Set();

/**
 * Starts polling GitHub issues with the configured label and creating tasks.
 * @param {string} projectId
 * @param {string} cwd
 */
export function startIssueSync(projectId, cwd) {
  if (intervalId) return;
  logger.info(`GitHub issue sync started (label: ${ISSUE_LABEL}, interval: ${POLL_INTERVAL_MS}ms)`, 'ISSUE_SYNC');
  intervalId = setInterval(() => syncIssues(projectId, cwd), POLL_INTERVAL_MS);
  syncIssues(projectId, cwd);
}

export function stopIssueSync() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('GitHub issue sync stopped', 'ISSUE_SYNC');
  }
}

async function syncIssues(projectId, cwd) {
  try {
    const shell = process.platform === 'win32';
    const out = execSync(
      `gh issue list --label "${ISSUE_LABEL}" --state open --json number,title,body,url --limit 50`,
      { cwd, stdio: 'pipe', shell }
    ).toString();

    const issues = JSON.parse(out);
    let created = 0;

    for (const issue of issues) {
      const key = `${issue.number}`;
      if (syncedIssues.has(key)) continue;

      await createTaskFromIssue(projectId, issue);
      syncedIssues.add(key);
      created++;
    }

    if (created > 0) logger.info(`Issue sync: ${created} new tasks created`, 'ISSUE_SYNC');
  } catch (err) {
    logger.error(`Issue sync failed: ${err.message}`, 'ISSUE_SYNC');
  }
}

async function createTaskFromIssue(projectId, issue) {
  const db = getDb();
  const taskRef = db.ref(`planning/${projectId}/tasks`).push();
  await taskRef.set({
    title: `[GH#${issue.number}] ${issue.title}`,
    description: issue.body || '',
    status: 'to-do',
    priority: 1,
    projectId,
    createdAt: Date.now(),
    createdBy: 'remoduler:issue-sync',
    sourceUrl: issue.url,
    githubIssueNumber: issue.number,
    decomposed: false,
    devPoints: 2,
    bizPoints: 3,
  });
  logger.info(`Task created from GH#${issue.number}: ${issue.title}`, 'ISSUE_SYNC');
}
