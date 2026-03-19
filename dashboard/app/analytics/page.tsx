'use client';

import { useLifetime, useLifetimeAgents } from '@/lib/hooks';

function fmt(n: number) { return n.toLocaleString(); }
function eur(usd: number) { return (usd * 0.92).toFixed(3); }
function fmtDur(ms: number) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
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

function TokenBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-primary)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4 }} />
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{fmt(value)}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const lt = useLifetime();
  const agents = useLifetimeAgents();

  const tokens = lt.totalTokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const tasksTotal = (lt.tasksCompleted || 0) + (lt.tasksFailed || 0);
  const avgCostPerTask = tasksTotal > 0 ? lt.totalCost / tasksTotal : 0;
  const avgTokensPerTask = tasksTotal > 0 ? tokens.total / tasksTotal : 0;
  const successRate = tasksTotal > 0 ? ((lt.tasksCompleted || 0) / tasksTotal * 100).toFixed(0) : '—';
  const avgCycles = (lt.tasksCompleted || 0) > 0 ? ((lt.totalReviewCycles || 0) / lt.tasksCompleted).toFixed(1) : '—';

  const agentEntries = Object.entries(agents);
  const totalAgentCost = agentEntries.reduce((sum, [, a]) => sum + (a.totalCost || 0), 0);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">Analytics</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Lifetime stats — since {lt.firstRunAt ? new Date(lt.firstRunAt).toLocaleDateString('es-ES') : '—'} — {lt.totalSessions || 0} sessions
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <StatCard label="Total Cost" value={`${eur(lt.totalCost || 0)}€`} sub={`$${(lt.totalCost || 0).toFixed(3)}`} />
        <StatCard label="Total Tokens" value={fmt(tokens.total)} sub={`in:${fmt(tokens.input)} out:${fmt(tokens.output)}`} />
        <StatCard label="Tasks Done" value={String(lt.tasksCompleted || 0)} sub={`${lt.tasksFailed || 0} failed`} />
        <StatCard label="Avg / Task" value={`${eur(avgCostPerTask)}€`} sub={`${fmt(Math.round(avgTokensPerTask))} tokens`} />
        <StatCard label="Success Rate" value={`${successRate}%`} sub={`${avgCycles} avg review cycles`} color={Number(successRate) >= 80 ? 'var(--success)' : 'var(--warning)'} />
      </div>

      <div className="card">
        <div className="card-header">Token Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <TokenBar label="Input" value={tokens.input} total={tokens.total} color="#3b82f6" />
          <TokenBar label="Output" value={tokens.output} total={tokens.total} color="#22c55e" />
          <TokenBar label="Cache Read" value={tokens.cacheRead} total={tokens.total} color="#a855f7" />
          <TokenBar label="Cache Write" value={tokens.cacheWrite} total={tokens.total} color="#f59e0b" />
        </div>
      </div>

      <div className="card">
        <div className="card-header">Lifetime per Agent</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '110px 1fr 80px 90px 70px 60px 50px',
            padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
          }}>
            <span>AGENT</span><span></span><span style={{ textAlign: 'right' }}>COST</span>
            <span style={{ textAlign: 'right' }}>TOKENS</span><span style={{ textAlign: 'right' }}>TIME</span>
            <span style={{ textAlign: 'right' }}>TURNS</span><span style={{ textAlign: 'right' }}>RUNS</span>
          </div>
          {agentEntries.map(([name, info]) => {
            const pct = totalAgentCost > 0 ? ((info.totalCost || 0) / totalAgentCost * 100) : 0;
            return (
              <div key={name} style={{
                display: 'grid', gridTemplateColumns: '110px 1fr 80px 90px 70px 60px 50px',
                padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--bg-secondary)',
                fontSize: 12, fontFamily: 'var(--font-mono)', alignItems: 'center',
              }}>
                <span style={{ fontWeight: 600 }}>{name}</span>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-primary)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3 }} />
                </div>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{eur(info.totalCost || 0)}€</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(info.totalTokens?.total || 0)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{fmtDur(info.totalDuration || 0)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{info.totalTurns || 0}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{info.runs || 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
