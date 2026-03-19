'use client';

import { useState, useEffect } from 'react';
import { sendCommand } from '@/lib/hooks';
import type { RemodulerState } from '@/lib/types';

export function Controls({ state }: { state: RemodulerState }) {
  const isRunning = state.execution === 'running';
  const isPaused = state.execution === 'paused' || state.pauseRequested;
  const isIdle = state.execution === 'idle' && !state.pauseRequested;

  const [tasks, setTasks] = useState('5');
  const [focus, setFocus] = useState('');
  const [starting, setStarting] = useState(false);

  // Reset starting when state changes to running
  useEffect(() => {
    if (isRunning) setStarting(false);
  }, [isRunning]);

  const startRun = async () => {
    setStarting(true);
    try {
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          tasks: parseInt(tasks) || 1,
          focus: focus || undefined,
        }),
      });
    } catch (err) {
      console.error('Failed to start:', err);
      setStarting(false);
    }
    // Don't setStarting(false) — wait for Firebase state to change to 'running'
  };

  return (
    <div className="card">
      <div className="card-header">Control</div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {/* Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: isRunning ? 'var(--success)' : isPaused ? 'var(--warning)' : 'var(--text-muted)',
            animation: isRunning ? 'pulse 2s infinite' : 'none',
            boxShadow: isRunning ? '0 0 8px var(--success)' : 'none',
          }} />
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            {state.execution.toUpperCase()}
          </span>
        </div>

        {/* Starting indicator */}
        {starting && (
          <div className="badge badge-running" style={{ fontSize: 13 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'pulse 1s infinite',
            }} />
            Starting...
          </div>
        )}

        {/* Start controls (only when idle and not starting) */}
        {isIdle && !starting && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tasks</label>
              <input
                type="number"
                value={tasks}
                onChange={e => setTasks(e.target.value)}
                min="0"
                style={{
                  width: 60, padding: '6px 8px', background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Focus</label>
              <input
                type="text"
                value={focus}
                onChange={e => setFocus(e.target.value)}
                placeholder="e.g. 9"
                style={{
                  width: 60, padding: '6px 8px', background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                }}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={startRun}
              disabled={starting}
              style={{ height: 34, padding: '0 20px', fontSize: 13, fontWeight: 600 }}
            >
              {starting ? 'Starting...' : '▶ Start'}
            </button>
          </>
        )}

        {/* Running controls */}
        {isRunning && !isPaused && (
          <>
            <button className="btn" onClick={() => sendCommand('pause')} style={{ height: 34 }}>
              ⏸ Pause
            </button>
            <button className="btn btn-danger" onClick={() => sendCommand('stop')} style={{ height: 34 }}>
              ■ Stop
            </button>
          </>
        )}

        {/* Paused controls */}
        {isPaused && (
          <>
            <button className="btn btn-primary" onClick={() => sendCommand('resume')} style={{ height: 34 }}>
              ▶ Resume
            </button>
            <button className="btn btn-danger" onClick={() => sendCommand('stop')} style={{ height: 34 }}>
              ■ Stop
            </button>
          </>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
