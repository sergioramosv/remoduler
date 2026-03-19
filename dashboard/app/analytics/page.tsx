'use client';

import { useLifetime, useLifetimeAgents } from '@/lib/hooks';

function fmt(n: number) { return n.toLocaleString(); }
function eur(usd: number) { return (usd * 0.92).toFixed(3); }
function fmtDur(ms: number) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const lt = useLifetime();
  const agents = useLifetimeAgents();

  const tokens = lt.totalTokens;
  const totalCost = lt.totalCost;
  const tasksTotal = lt.tasksCompleted + lt.tasksFailed;
  const avgCostPerTask = tasksTotal > 0 ? totalCost / tasksTotal : 0;
  const avgTokensPerTask = tasksTotal > 0 ? tokens.total / tasksTotal : 0;
  const successRate = tasksTotal > 0 ? (lt.tasksCompleted / tasksTotal * 100).toFixed(0) : '—';

  const agentEntries = Object.entries(agents);
  const totalAgentCost = agentEntries.reduce((sum, [, a]) => sum + (a.totalCost || 0), 0);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">Analytics</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Usage statistics and cost analysis
          </div>
        </div>
      </div>

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <StatCard label="Total Cost" value={`${eur(totalCost)}€`} sub={`$${totalCost.toFixed(3)}`} />
        <StatCard label="Total Tokens" value={fmt(tokens.total)} sub={`in:${fmt(tokens.input)} out:${fmt(tokens.output)}`} />
        <StatCard label="Tasks Done" value={String(lt.tasksCompleted)} sub={`${lt.tasksFailed} failed`} />
        <StatCard label="Avg / Task" value={`${eur(avgCostPerTask)}€`} sub={`${fmt(Math.round(avgTokensPerTask))} tokens`} />
        <StatCard label="Success Rate" value={`${successRate}%`} color={Number(successRate) >= 80 ? 'var(--success)' : 'var(--warning)'} />
      </div>

      {/* Token breakdown */}
      <div className="card">
        <div className="card-header">Token Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <TokenBar label="Input" value={tokens.input} total={tokens.total} color="#3b82f6" />
          <TokenBar label="Output" value={tokens.output} total={tokens.total} color="#22c55e" />
          <TokenBar label="Cache Read" value={tokens.cacheRead} total={tokens.total} color="#a855f7" />
          <TokenBar label="Cache Write" value={tokens.cacheWrite} total={tokens.total} color="#f59e0b" />
        </div>
      </div>

      {/* Per Agent */}
      <div className="card">
        <div className="card-header">Cost & Time per Agent</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 1fr 90px 100px 80px 70px',
            padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
          }}>
            <span>AGENT</span><span></span><span style={{ textAlign: 'right' }}>COST</span>
            <span style={{ textAlign: 'right' }}>TOKENS</span><span style={{ textAlign: 'right' }}>TIME</span>
            <span style={{ textAlign: 'right' }}>TURNS</span>
          </div>
          {agentEntries.map(([name, info]) => {
            const pct = totalAgentCost > 0 ? ((info.totalCost || 0) / totalAgentCost * 100) : 0;
            return (
              <div key={name} style={{
                display: 'grid', gridTemplateColumns: '120px 1fr 90px 100px 80px 70px',
                padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--bg-secondary)',
                fontSize: 12, fontFamily: 'var(--font-mono)', alignItems: 'center',
              }}>
                <span style={{ fontWeight: 600 }}>{name}</span>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-primary)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{eur(info.totalCost || 0)}€</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(info.totalTokens?.total || 0)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{fmtDur(info.totalDuration || 0)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{info.totalTurns || 0}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget usage */}
      <div className="card">
        <div className="card-header">Budget Usage</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <BudgetMeter label="Daily" spent={totalCost} limit={10} />
          <BudgetMeter label="Weekly" spent={totalCost} limit={50} />
        </div>
      </div>
    </div>
  );
}

function TokenBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-primary)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{fmt(value)}</div>
    </div>
  );
}

function BudgetMeter({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const pct = Math.min((spent / limit) * 100, 100);
  const color = pct >= 100 ? 'var(--error)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span className="mono" style={{ fontSize: 13, color }}>{eur(spent)}€ / {eur(limit)}€</span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-primary)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 0.5s' }} />
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{pct.toFixed(0)}% used</div>
    </div>
  );
}
