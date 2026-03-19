'use client';

import { useState, useEffect } from 'react';
import { db, ref, onValue, push } from './firebase';
import type { RemodulerState, AgentInfo, HistoryEntry, RateLimitInfo } from './types';

const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID || '-Onv5qyYftZMhkbq3cna';

function useListen<T>(path: string, fallback: T): T {
  const [data, setData] = useState<T>(fallback);

  useEffect(() => {
    const dbRef = ref(db, `remoduler/${PROJECT_ID}/${path}`);
    const unsub = onValue(dbRef, (snap) => {
      const val = snap.val();
      if (val !== null) setData(val as T);
    });
    return () => unsub();
  }, [path]);

  return data;
}

export function useRemodulerState(): RemodulerState {
  return useListen<RemodulerState>('state', {
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
    updatedAt: 0,
  });
}

// Session agents (current run only)
export function useAgents(): Record<string, AgentInfo> {
  return useListen<Record<string, AgentInfo>>('sessionAgents', {});
}

// Lifetime stats (accumulated, never reset)
export interface LifetimeStats {
  totalCost: number;
  totalTokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  tasksCompleted: number;
  tasksFailed: number;
  totalReviewCycles: number;
  totalSessions: number;
  firstRunAt: number;
  lastRunAt: number;
}

export function useLifetime(): LifetimeStats {
  return useListen<LifetimeStats>('lifetime', {
    totalCost: 0, totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tasksCompleted: 0, tasksFailed: 0, totalReviewCycles: 0, totalSessions: 0, firstRunAt: 0, lastRunAt: 0,
  });
}

export interface LifetimeAgentInfo {
  totalCost: number;
  totalTokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  totalTurns: number;
  totalDuration: number;
  runs: number;
}

export function useLifetimeAgents(): Record<string, LifetimeAgentInfo> {
  return useListen<Record<string, LifetimeAgentInfo>>('lifetimeAgents', {});
}

export function useHistory(): HistoryEntry[] {
  const raw = useListen<Record<string, HistoryEntry>>('history', {});
  return Object.values(raw).sort((a, b) => b.timestamp - a.timestamp);
}

export function useRateLimit(): RateLimitInfo | null {
  return useListen<RateLimitInfo | null>('rateLimit', null);
}

export function sendCommand(action: 'pause' | 'stop' | 'resume') {
  const cmdRef = ref(db, `remoduler/${PROJECT_ID}/commands`);
  push(cmdRef, { action, timestamp: Date.now() });
}
