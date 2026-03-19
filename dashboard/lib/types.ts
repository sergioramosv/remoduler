export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface RemodulerState {
  execution: 'idle' | 'running' | 'paused' | 'stopped';
  currentPhase: string | null;
  currentAgent: string | null;
  currentTask: {
    taskId: string;
    title: string;
    devPoints: number;
    startedAt: number;
  } | null;
  startedAt: number | null;
  totalCost: number;
  totalTokens: Tokens;
  tasksCompleted: number;
  tasksFailed: number;
  pauseRequested: boolean;
  stopRequested: boolean;
  updatedAt: number;
}

export interface AgentInfo {
  status: 'running' | 'done' | 'failed';
  cost: number;
  turns: number;
  tokens: Tokens | null;
  duration?: number;
  startedAt: number;
  finishedAt?: number;
}

export interface HistoryEntry {
  action: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface RateLimitInfo {
  limited: boolean;
  cli: string;
  agent: string;
  detectedAt: number;
}

export const PHASES = ['planning', 'architecting', 'coding', 'testing', 'security', 'reviewing'] as const;

export const PHASE_LABELS: Record<string, string> = {
  planning: 'Planning',
  architecting: 'Architect',
  coding: 'Coding',
  testing: 'Testing',
  security: 'Security',
  reviewing: 'Review',
};

export const HISTORY_ICONS: Record<string, string> = {
  task_start: '▶',
  task_complete: '✓',
  task_failed: '✗',
  agent_start: '⚡',
  pr_created: '↗',
  review_approved: '✓',
  review_changes: '↻',
  rate_limit: '⏸',
  budget_warning: '⚠',
  budget_exceeded: '🛑',
  orchestrator_done: '■',
};
