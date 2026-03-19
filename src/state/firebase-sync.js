import { getDb } from '../firebase.js';
import { eventBus } from '../events/event-bus.js';
import { config } from '../config.js';

/**
 * Sincroniza el estado del orquestador a Firebase en tiempo real.
 * El dashboard lee estos datos con listeners onValue().
 * También escucha comandos del dashboard (pause/stop).
 */

let projectId = null;
let unsubscribeCommand = null;

function ref(path) {
  return getDb().ref(`remoduler/${projectId}/${path}`);
}

export async function startSync(pid) {
  projectId = pid;

  // Init state
  await ref('state').set({
    execution: 'idle',
    currentPhase: null,
    currentAgent: null,
    currentTask: null,
    startedAt: null,
    totalCost: 0,
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tasksCompleted: 0,
    tasksFailed: 0,
    pauseRequested: false,
    stopRequested: false,
    updatedAt: Date.now(),
  });

  await ref('agents').set({});
  await ref('rateLimit').remove();

  // Listen for dashboard commands (pause/stop)
  const cmdRef = ref('commands');
  unsubscribeCommand = cmdRef.on('child_added', async (snapshot) => {
    const cmd = snapshot.val();
    if (cmd?.action === 'pause') {
      eventBus.emit('dashboard:pause', {});
    } else if (cmd?.action === 'stop') {
      eventBus.emit('dashboard:stop', {});
    }
    // Remove processed command
    await snapshot.ref.remove();
  });

  // Wire events to Firebase
  eventBus.on('state:execution', ({ execution }) => {
    ref('state/execution').set(execution);
    ref('state/updatedAt').set(Date.now());
    if (execution === 'running') ref('state/startedAt').set(Date.now());
  });

  eventBus.on('state:task', ({ task }) => {
    ref('state/currentTask').set(task);
    ref('state/updatedAt').set(Date.now());
  });

  eventBus.on('state:agent', ({ agent }) => {
    ref('state/currentAgent').set(agent);
    ref('state/updatedAt').set(Date.now());
  });

  eventBus.on('agent:start', ({ agent }) => {
    ref(`agents/${agent}`).update({ status: 'running', startedAt: Date.now() });
    ref('state/currentAgent').set(agent);
    ref('state/currentPhase').set(agentToPhase(agent));
    addHistory('agent_start', `${agent} started`, { agent });
  });

  eventBus.on('agent:done', ({ agent, success, cost, turns, tokens, duration }) => {
    ref(`agents/${agent}`).update({
      status: success ? 'done' : 'failed',
      cost: cost || 0,
      turns: turns || 0,
      tokens: tokens || null,
      duration: duration || 0,
      finishedAt: Date.now(),
    });
    ref('state/currentAgent').set(null);
    ref('state/totalCost').transaction(c => (c || 0) + (cost || 0));
    if (tokens) {
      ref('state/totalTokens').transaction(t => {
        if (!t) t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        return {
          input: (t.input || 0) + (tokens.input || 0),
          output: (t.output || 0) + (tokens.output || 0),
          cacheRead: (t.cacheRead || 0) + (tokens.cacheRead || 0),
          cacheWrite: (t.cacheWrite || 0) + (tokens.cacheWrite || 0),
          total: (t.total || 0) + (tokens.total || 0),
        };
      });
    }
  });

  eventBus.on('task:start', ({ taskId, title, devPoints }) => {
    ref('state/currentTask').set({ taskId, title, devPoints, startedAt: Date.now() });
    addHistory('task_start', `Task started: ${title}`, { taskId, title, devPoints });
  });

  eventBus.on('task:prCreated', ({ taskId, prNumber, prUrl }) => {
    addHistory('pr_created', `PR #${prNumber} created`, { taskId, prNumber, prUrl });
  });

  eventBus.on('task:complete', ({ taskId, totalCost, cycles }) => {
    ref('state/tasksCompleted').transaction(c => (c || 0) + 1);
    ref('state/currentTask').set(null);
    ref('state/currentPhase').set('idle');
    addHistory('task_complete', `Task completed (${cycles} review cycles, $${totalCost?.toFixed(4)})`, { taskId, totalCost, cycles });
  });

  eventBus.on('task:failed', ({ taskId, error }) => {
    ref('state/tasksFailed').transaction(c => (c || 0) + 1);
    ref('state/currentTask').set(null);
    addHistory('task_failed', `Task failed: ${error}`, { taskId, error });
  });

  eventBus.on('review:approved', ({ cycle, score }) => {
    addHistory('review_approved', `Review approved (score: ${score}, cycle: ${cycle})`, { cycle, score });
  });

  eventBus.on('review:changes', ({ cycle, score, issues }) => {
    addHistory('review_changes', `Review: REQUEST_CHANGES (score: ${score}, ${issues} issues)`, { cycle, score, issues });
  });

  eventBus.on('rate-limit:detected', ({ cli, agentName }) => {
    ref('rateLimit').set({ limited: true, cli, agent: agentName, detectedAt: Date.now() });
    addHistory('rate_limit', `Rate limit detected on ${cli} (${agentName})`, { cli, agentName });
  });

  eventBus.on('heartbeat:recovered', ({ cli }) => {
    ref('rateLimit').remove();
    addHistory('rate_recovered', `Rate limit recovered: ${cli}`, { cli });
  });

  eventBus.on('heartbeat:allRecovered', () => {
    ref('rateLimit').remove();
  });

  eventBus.on('budget:warning', (data) => {
    addHistory('budget_warning', `Budget warning: ${data.type} at ${(data.spent / data.limit * 100).toFixed(0)}%`, data);
  });

  eventBus.on('budget:exceeded', (data) => {
    addHistory('budget_exceeded', `Budget exceeded: ${data.type}`, data);
  });

  eventBus.on('orchestrator:done', ({ completed, failed, totalCost, tokens, duration }) => {
    ref('state/execution').set('idle');
    ref('state/currentPhase').set(null);
    ref('state/currentAgent').set(null);
    addHistory('orchestrator_done', `Done: ${completed} completed, ${failed} failed, $${totalCost?.toFixed(4)}, ${(duration / 1000).toFixed(0)}s`, { completed, failed, totalCost, tokens, duration });
  });
}

export async function stopSync() {
  if (unsubscribeCommand && projectId) {
    ref('commands').off('child_added', unsubscribeCommand);
  }
  projectId = null;
}

async function addHistory(action, message, data = {}) {
  if (!projectId) return;
  try {
    await ref('history').push({
      action,
      message,
      data,
      timestamp: Date.now(),
    });
  } catch {}
}

function agentToPhase(agent) {
  const map = {
    PLANNER: 'planning',
    ARCHITECT: 'architecting',
    CODER: 'coding',
    QA: 'testing',
    TESTER: 'testing',
    SECURITY: 'security',
    REVIEWER: 'reviewing',
  };
  return map[agent] || agent;
}
