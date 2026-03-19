'use client';

import { PHASES, PHASE_LABELS } from '@/lib/types';

const PHASE_COLORS: Record<string, string> = {
  planning: '#6366f1',
  architecting: '#06b6d4',
  coding: '#22c55e',
  testing: '#f59e0b',
  security: '#a855f7',
  reviewing: '#ec4899',
};

export function PipelineView({ currentPhase }: { currentPhase: string | null }) {
  return (
    <div className="card">
      <div className="card-header">Pipeline</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {PHASES.map((phase, i) => {
          const isActive = currentPhase === phase;
          const isDone = currentPhase ? PHASES.indexOf(currentPhase as typeof PHASES[number]) > i : false;
          const color = PHASE_COLORS[phase];

          return (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <div style={{
                flex: 1,
                padding: '14px 8px',
                borderRadius: 'var(--radius)',
                background: isActive ? `${color}18` : isDone ? `${color}15` : 'var(--bg-secondary)',
                border: `2px solid ${isActive ? color : isDone ? `${color}50` : 'var(--border)'}`,
                textAlign: 'center',
                transition: 'all 0.3s',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Fill & empty animation */}
                {isActive && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: '100%',
                    background: `${color}30`,
                    transformOrigin: 'left center',
                    animation: 'fillEmpty 3s ease-in-out infinite',
                  }} />
                )}

                {/* Done: solid fill */}
                {isDone && (
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, bottom: 0, right: 0,
                    background: `${color}12`,
                  }} />
                )}

                <div style={{
                  position: 'relative',
                  zIndex: 1,
                  fontSize: 11,
                  fontWeight: 700,
                  color: isActive ? color : isDone ? color : 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {isDone ? '✓ ' : isActive ? '● ' : ''}{PHASE_LABELS[phase]}
                </div>
              </div>
              {i < PHASES.length - 1 && (
                <div style={{
                  color: isDone ? color : 'var(--text-muted)',
                  fontSize: 10,
                  transition: 'color 0.3s',
                }}>→</div>
              )}
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes fillEmpty {
          0% { transform: scaleX(0); transform-origin: left; }
          45% { transform: scaleX(1); transform-origin: left; }
          55% { transform: scaleX(1); transform-origin: right; }
          100% { transform: scaleX(0); transform-origin: right; }
        }
      `}</style>
    </div>
  );
}
