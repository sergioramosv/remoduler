'use client';

import { sendCommand } from '@/lib/hooks';
import type { RemodulerState } from '@/lib/types';

export function Controls({ state }: { state: RemodulerState }) {
  const isRunning = state.execution === 'running';
  const isPaused = state.pauseRequested;

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {isRunning && !isPaused && (
        <button className="btn btn-danger" onClick={() => sendCommand('pause')}>
          ⏸ Pause
        </button>
      )}
      {isRunning && (
        <button className="btn btn-danger" onClick={() => sendCommand('stop')}>
          ■ Stop
        </button>
      )}
      {isPaused && (
        <button className="btn btn-primary" onClick={() => sendCommand('resume')}>
          ▶ Resume
        </button>
      )}
      <div className={`badge ${isRunning ? 'badge-running' : 'badge-idle'}`}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isRunning ? 'var(--accent)' : 'var(--text-muted)',
          animation: isRunning ? 'pulse 2s infinite' : 'none',
        }} />
        {state.execution.toUpperCase()}
      </div>
    </div>
  );
}
