'use client';

import { PHASES, PHASE_LABELS } from '@/lib/types';

const PHASE_COLORS: Record<string, string> = {
  planning: 'var(--phase-planning)',
  architecting: 'var(--phase-architecting)',
  coding: 'var(--phase-coding)',
  testing: 'var(--phase-testing)',
  security: 'var(--phase-security)',
  reviewing: 'var(--phase-reviewing)',
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
                background: isActive ? `${color}15` : isDone ? `${color}10` : 'var(--bg-secondary)',
                border: `2px solid ${isActive ? color : isDone ? `${color}40` : 'var(--border)'}`,
                textAlign: 'center',
                transition: 'all 0.3s',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Fill animation for active phase */}
                {isActive && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: '100%',
                    background: `linear-gradient(90deg, ${color}30, ${color}08)`,
                    animation: 'fillSweep 2.5s ease-in-out infinite',
                    transformOrigin: 'left',
                  }} />
                )}

                {/* Done fill */}
                {isDone && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
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
        @keyframes fillSweep {
          0% { transform: scaleX(0); opacity: 0.3; }
          50% { transform: scaleX(1); opacity: 1; }
          100% { transform: scaleX(0); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
