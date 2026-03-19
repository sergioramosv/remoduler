'use client';

import { useRemodulerState, useAgents, useHistory, useRateLimit } from '@/lib/hooks';
import { PipelineView } from '@/components/PipelineView';
import { TaskDetail } from '@/components/TaskDetail';
import { StatsBar } from '@/components/StatsBar';
import { Timeline } from '@/components/Timeline';
import { Controls } from '@/components/Controls';
import { ToastContainer } from '@/components/Toast';

export default function DashboardPage() {
  const state = useRemodulerState();
  const agents = useAgents();
  const history = useHistory();
  const rateLimit = useRateLimit();

  return (
    <>
      <ToastContainer history={history} />

      <div className="dashboard">
        {/* Controls — Start / Pause / Stop / Resume */}
        <Controls state={state} />

        {/* Rate limit bar */}
        {rateLimit?.limited && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--error)',
            borderRadius: 'var(--radius)',
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--error)', fontWeight: 600 }}>
              ⏸ Rate Limit — {rateLimit.cli} ({rateLimit.agent})
            </span>
            <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Detected {new Date(rateLimit.detectedAt).toLocaleTimeString('es-ES')}
            </span>
          </div>
        )}

        {/* Pipeline */}
        <PipelineView currentPhase={state.currentPhase} />

        {/* Main grid */}
        <div className="dashboard-grid">
          <div className="main-col">
            <TaskDetail state={state} />
            <StatsBar state={state} agents={agents} />
          </div>
          <div className="side-col">
            <Timeline history={history} />
          </div>
        </div>
      </div>
    </>
  );
}
