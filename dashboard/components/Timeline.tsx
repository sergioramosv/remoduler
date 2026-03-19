'use client';

import type { HistoryEntry } from '@/lib/types';
import { HISTORY_ICONS } from '@/lib/types';

const ACTION_COLORS: Record<string, string> = {
  task_start: 'var(--accent)',
  task_complete: 'var(--success)',
  task_failed: 'var(--error)',
  agent_start: 'var(--info)',
  pr_created: 'var(--phase-coding)',
  review_approved: 'var(--success)',
  review_changes: 'var(--warning)',
  rate_limit: 'var(--error)',
  budget_warning: 'var(--warning)',
  budget_exceeded: 'var(--error)',
  orchestrator_done: 'var(--text-muted)',
};

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export function Timeline({ history }: { history: HistoryEntry[] }) {
  return (
    <div className="card" style={{ maxHeight: 500, overflow: 'auto' }}>
      <div className="card-header">Activity</div>

      {history.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
          No activity yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {history.slice(0, 50).map((entry, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '8px 10px',
              borderRadius: 'var(--radius)', fontSize: 13,
              borderLeft: `3px solid ${ACTION_COLORS[entry.action] || 'var(--border)'}`,
              background: 'var(--bg-secondary)',
            }}>
              <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>
                {HISTORY_ICONS[entry.action] || '•'}
              </span>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{entry.message}</span>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                {timeAgo(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
