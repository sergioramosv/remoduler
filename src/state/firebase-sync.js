import { getDb } from '../firebase.js';
import { eventBus } from '../events/event-bus.js';

let projectId = null;
let unsubscribeCommand = null;

function ref(path) {
  return getDb().ref(`remoduler/${projectId}/${path}`);
}

function addTok(base, add) {
  if (!base) base = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (!add) return base;
  return {
    input: (base.input || 0) + (add.input || 0),
    output: (base.output || 0) + (add.output || 0),
    cacheRead: (base.cacheRead || 0) + (add.cacheRead || 0),
    cacheWrite: (base.cacheWrite || 0) + (add.cacheWrite || 0),
    total: (base.total || 0) + (add.total || 0),
  };
}

export async function startSync(pid) {
  projectId = pid;

  // Session state — only reset live fields, NOT totals
  await ref('state').update({
    execution: 'idle',
    currentPhase: null,
    currentAgent: null,
    currentTask: null,
    startedAt: null,
    pauseRequested: false,
    stopRequested: false,
    updatedAt: Date.now(),
  });

  await ref('sessionAgents').set({});
  await ref('rateLimit').remove();

  // Lifetime — create if missing, never reset
  const ltSnap = await ref('lifetime').once('value');
  if (!ltSnap.val()) {
    await ref('lifetime').set({
      totalCost: 0,
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      tasksCompleted: 0, tasksFailed: 0, totalReviewCycles: 0,
      totalSessions: 1, firstRunAt: Date.now(), lastRunAt: Date.now(),
    });
  } else {
    await ref('lifetime/totalSessions').transaction(s => (s || 0) + 1);
    await ref('lifetime/lastRunAt').set(Date.now());
  }

  // Dashboard commands
  const cmdRef = ref('commands');
  unsubscribeCommand = cmdRef.on('child_added', async (snap) => {
    const cmd = snap.val();
    if (cmd?.action === 'pause') eventBus.emit('dashboard:pause', {});
    else if (cmd?.action === 'stop') eventBus.emit('dashboard:stop', {});
    else if (cmd?.action === 'approval_response') {
      eventBus.emit('autonomy:approval-response', {
        requestId: cmd.requestId,
        approved: cmd.approved === true,
        respondedBy: cmd.respondedBy || 'dashboard',
      });
    }
    await snap.ref.remove();
  });

  // === Events → Firebase ===

  eventBus.on('state:execution', ({ execution }) => {
    ref('state/execution').set(execution);
    ref('state/updatedAt').set(Date.now());
    if (execution === 'running') ref('state/startedAt').set(Date.now());
  });

  eventBus.on('state:task', ({ task }) => ref('state/currentTask').set(task));
  eventBus.on('state:agent', ({ agent }) => ref('state/currentAgent').set(agent));

  eventBus.on('agent:start', ({ agent }) => {
    ref(`sessionAgents/${agent}`).update({ status: 'running', startedAt: Date.now() });
    ref('state/currentAgent').set(agent);
    ref('state/currentPhase').set(agentToPhase(agent));
    addHistory('agent_start', `${agent} started`, { agent });
  });

  eventBus.on('agent:done', ({ agent, success, cost, turns, tokens, duration }) => {
    ref(`sessionAgents/${agent}`).update({
      status: success ? 'done' : 'failed',
      cost: cost || 0, turns: turns || 0, tokens: tokens || null,
      duration: duration || 0, finishedAt: Date.now(),
    });
    ref('state/currentAgent').set(null);

    // Lifetime accumulate
    ref('lifetime/totalCost').transaction(c => (c || 0) + (cost || 0));
    if (tokens) ref('lifetime/totalTokens').transaction(t => addTok(t, tokens));
    ref(`lifetimeAgents/${agent}`).transaction(a => {
      if (!a) a = { totalCost: 0, totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, totalTurns: 0, totalDuration: 0, runs: 0 };
      return {
        totalCost: (a.totalCost || 0) + (cost || 0),
        totalTokens: addTok(a.totalTokens, tokens),
        totalTurns: (a.totalTurns || 0) + (turns || 0),
        totalDuration: (a.totalDuration || 0) + (duration || 0),
        runs: (a.runs || 0) + 1,
      };
    });
  });

  eventBus.on('task:start', ({ taskId, title, devPoints }) => {
    ref('state/currentTask').set({ taskId, title, devPoints, startedAt: Date.now() });
    addHistory('task_start', `Task started: ${title}`, { taskId, title, devPoints });
  });

  eventBus.on('task:prCreated', ({ taskId, prNumber, prUrl }) => {
    addHistory('pr_created', `PR #${prNumber} created`, { taskId, prNumber, prUrl });
  });

  eventBus.on('task:complete', ({ taskId, totalCost, cycles }) => {
    ref('state/currentTask').set(null);
    ref('state/currentPhase').set('idle');
    ref('lifetime/tasksCompleted').transaction(c => (c || 0) + 1);
    ref('lifetime/totalReviewCycles').transaction(c => (c || 0) + (cycles || 0));
    addHistory('task_complete', `Task completed (${cycles} cycles, $${totalCost?.toFixed(4)})`, { taskId, totalCost, cycles });
  });

  eventBus.on('task:failed', ({ taskId, error }) => {
    ref('state/currentTask').set(null);
    ref('lifetime/tasksFailed').transaction(c => (c || 0) + 1);
    addHistory('task_failed', `Task failed: ${error}`, { taskId, error });
  });

  eventBus.on('review:approved', ({ cycle, score }) => addHistory('review_approved', `Review approved (score: ${score}, cycle: ${cycle})`, { cycle, score }));
  eventBus.on('review:changes', ({ cycle, score, issues }) => addHistory('review_changes', `REQUEST_CHANGES (score: ${score}, ${issues} issues)`, { cycle, score, issues }));

  eventBus.on('rate-limit:detected', ({ cli, agentName }) => {
    ref('rateLimit').set({ limited: true, cli, agent: agentName, detectedAt: Date.now() });
    addHistory('rate_limit', `Rate limit: ${cli} (${agentName})`, { cli, agentName });
  });
  eventBus.on('heartbeat:recovered', ({ cli }) => { ref('rateLimit').remove(); addHistory('rate_recovered', `Recovered: ${cli}`, { cli }); });
  eventBus.on('heartbeat:allRecovered', () => ref('rateLimit').remove());

  eventBus.on('budget:warning', (d) => addHistory('budget_warning', `Budget ${d.type} at ${(d.spent / d.limit * 100).toFixed(0)}%`, d));
  eventBus.on('budget:exceeded', (d) => addHistory('budget_exceeded', `Budget exceeded: ${d.type}`, d));

  eventBus.on('autonomy:approval-request', (data) => {
    addHistory('approval_request', `Approval requested for '${data.action}'`, data);
  });

  eventBus.on('orchestrator:done', ({ completed, failed, totalCost, tokens, duration }) => {
    ref('state/execution').set('idle');
    ref('state/currentPhase').set(null);
    ref('state/currentAgent').set(null);
    addHistory('orchestrator_done', `Done: ${completed} ok, ${failed} fail, $${totalCost?.toFixed(4)}, ${(duration / 1000).toFixed(0)}s`, { completed, failed, totalCost, tokens, duration });
  });
}

export async function stopSync() {
  if (unsubscribeCommand && projectId) ref('commands').off('child_added', unsubscribeCommand);
  projectId = null;
}

async function addHistory(action, message, data = {}) {
  if (!projectId) return;
  try { await ref('history').push({ action, message, data, timestamp: Date.now() }); } catch {}
}

function agentToPhase(a) {
  return { PLANNER: 'planning', ARCHITECT: 'architecting', CODER: 'coding', QA: 'testing', TESTER: 'testing', SECURITY: 'security', REVIEWER: 'reviewing' }[a] || a;
}
