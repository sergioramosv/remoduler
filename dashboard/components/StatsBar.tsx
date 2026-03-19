'use client';

import type { RemodulerState, AgentInfo } from '@/lib/types';

function fmt(n: number) { return n.toLocaleString(); }

export function StatsBar({ state, agents }: { state: RemodulerState; agents: Record<string, AgentInfo> }) {
  const costEur = (state.totalCost * 0.92).toFixed(3);
  const costUsd = state.totalCost.toFixed(3);
  const tokens = state.totalTokens;

  return (
    <div className="card">
      <div className="card-header">Stats</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Stat label="Cost" value={`${costEur}€`} sub={`$${costUsd}`} />
        <Stat label="Tokens" value={fmt(tokens.total)} sub={`in:${fmt(tokens.input)} out:${fmt(tokens.output)}`} />
        <Stat label="Tasks" value={String(state.tasksCompleted)} sub={`${state.tasksFailed} failed`} color={state.tasksFailed > 0 ? 'var(--error)' : undefined} />
        <Stat label="Status" value={state.execution.toUpperCase()} color={state.execution === 'running' ? 'var(--accent)' : undefined} />
      </div>

      {/* Per agent breakdown */}
      {Object.keys(agents).length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>PER AGENT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(agents).map(([name, info]) => (
              <div key={name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', borderRadius: 'var(--radius)', background: 'var(--bg-secondary)',
                fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: info.status === 'running' ? 'var(--accent)' : info.status === 'done' ? 'var(--success)' : 'var(--error)',
                  }} />
                  <span style={{ fontWeight: 600 }}>{name}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {(info.cost * 0.92).toFixed(3)}€ | {fmt(info.tokens?.total || 0)} tok
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}
