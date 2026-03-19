'use client';

import type { RemodulerState } from '@/lib/types';

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function TaskDetail({ state }: { state: RemodulerState }) {
  const task = state.currentTask;
  const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;

  return (
    <div className="card">
      <div className="card-header">Current Task</div>

      {!task ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0', textAlign: 'center' }}>
          {state.execution === 'idle' ? 'No task running' : 'Selecting task...'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{task.title}</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>DEV POINTS</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{task.devPoints || '?'}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>ELAPSED</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{formatDuration(elapsed)}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>AGENT</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
                {state.currentAgent || '—'}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            ID: {task.taskId}
          </div>
        </div>
      )}
    </div>
  );
}
