'use client';

import { useState } from 'react';
import { useHistory } from '@/lib/hooks';
import { HISTORY_ICONS } from '@/lib/types';
import type { HistoryEntry } from '@/lib/types';

type Period = 'today' | 'week' | 'month' | 'all';

const ACTION_COLORS: Record<string, string> = {
  task_start: '#6366f1',
  task_complete: '#22c55e',
  task_failed: '#ef4444',
  agent_start: '#3b82f6',
  pr_created: '#22c55e',
  review_approved: '#22c55e',
  review_changes: '#f59e0b',
  rate_limit: '#ef4444',
  rate_recovered: '#22c55e',
  budget_warning: '#f59e0b',
  budget_exceeded: '#ef4444',
  orchestrator_done: '#71717a',
};

function filterByPeriod(entries: HistoryEntry[], period: Period): HistoryEntry[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  switch (period) {
    case 'today': return entries.filter(e => now - e.timestamp < day);
    case 'week': return entries.filter(e => now - e.timestamp < 7 * day);
    case 'month': return entries.filter(e => now - e.timestamp < 30 * day);
    default: return entries;
  }
}

function groupByDate(entries: HistoryEntry[]): Record<string, HistoryEntry[]> {
  const groups: Record<string, HistoryEntry[]> = {};
  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(entry);
  }
  return groups;
}

function getStats(entries: HistoryEntry[]) {
  const tasks = entries.filter(e => e.action === 'task_complete');
  const failed = entries.filter(e => e.action === 'task_failed');
  const totalCost = tasks.reduce((sum, e) => sum + ((e.data?.totalCost as number) || 0), 0);
  const totalCycles = tasks.reduce((sum, e) => sum + ((e.data?.cycles as number) || 0), 0);
  return {
    completed: tasks.length,
    failed: failed.length,
    totalCost,
    avgCycles: tasks.length > 0 ? (totalCycles / tasks.length).toFixed(1) : '—',
  };
}

export default function HistoryPage() {
  const history = useHistory();
  const [period, setPeriod] = useState<Period>('today');

  const filtered = filterByPeriod(history, period);
  const grouped = groupByDate(filtered);
  const stats = getStats(filtered);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">History</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Activity log grouped by date
          </div>
        </div>

        {/* Period filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['today', 'week', 'month', 'all'] as Period[]).map(p => (
            <button
              key={p}
              className={`btn ${period === p ? 'btn-primary' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Period stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>COMPLETED</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{stats.completed}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>FAILED</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: stats.failed > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{stats.failed}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>COST</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 700 }}>{(stats.totalCost * 0.92).toFixed(2)}€</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>AVG REVIEW CYCLES</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 700 }}>{stats.avgCycles}</div>
        </div>
      </div>

      {/* Timeline grouped by date */}
      {Object.keys(grouped).length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          No activity for this period
        </div>
      ) : (
        Object.entries(grouped).map(([date, entries]) => (
          <div key={date} className="card">
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
              marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)',
            }}>
              {date} — {entries.length} events
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {entries.map((entry, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '7px 10px',
                  borderRadius: 'var(--radius)', fontSize: 13,
                  borderLeft: `3px solid ${ACTION_COLORS[entry.action] || 'var(--border)'}`,
                  background: 'var(--bg-secondary)',
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>
                    {HISTORY_ICONS[entry.action] || '•'}
                  </span>
                  <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{entry.message}</span>
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                    {new Date(entry.timestamp).toLocaleTimeString('es-ES')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Total events count */}
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
        {filtered.length} events total
      </div>
    </div>
  );
}
