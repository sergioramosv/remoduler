'use client';

import { useState, useEffect } from 'react';
import { db, ref, onValue } from '@/lib/firebase';
import { set } from 'firebase/database';

const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID || '-Onv5qyYftZMhkbq3cna';

interface Settings {
  dailyBudgetUsd: number;
  weeklyBudgetUsd: number;
  budgetUnlimited: boolean;
  maxReviewCycles: number;
  autoMerge: boolean;
  cliPlanner: string;
  cliCoder: string;
  cliReviewer: string;
  cliArchitect: string;
  focusPhase: string;
}

const DEFAULTS: Settings = {
  dailyBudgetUsd: 10,
  weeklyBudgetUsd: 50,
  budgetUnlimited: false,
  maxReviewCycles: 3,
  autoMerge: true,
  cliPlanner: 'claude',
  cliCoder: 'claude',
  cliReviewer: 'claude',
  cliArchitect: 'claude',
  focusPhase: '',
};

function Field({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>
      {children}
      {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>}
    </div>
  );
}

function Input({ value, onChange, type = 'text', disabled }: {
  value: string | number; onChange: (v: string) => void; type?: string; disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--bg-primary)' : 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '8px 12px',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: 13,
        fontFamily: 'var(--font-mono)',
        width: '100%',
        outline: 'none',
      }}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        padding: '8px 12px', borderRadius: 'var(--radius)',
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      }}
    >
      <div style={{
        width: 36, height: 20, borderRadius: 10, padding: 2,
        background: checked ? 'var(--accent)' : 'var(--border)',
        transition: 'background 0.2s',
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: '50%', background: 'white',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.2s',
        }} />
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load from Firebase
  useEffect(() => {
    const settingsRef = ref(db, `remoduler/${PROJECT_ID}/settings`);
    const unsub = onValue(settingsRef, (snap) => {
      const val = snap.val();
      if (val) setSettings({ ...DEFAULTS, ...val });
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const update = (key: keyof Settings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    const settingsRef = ref(db, `remoduler/${PROJECT_ID}/settings`);
    await set(settingsRef, settings);

    // If unlimited, set budget very high
    if (settings.budgetUnlimited) {
      const budgetRef = ref(db, `remoduler/${PROJECT_ID}/overrides`);
      await set(budgetRef, {
        dailyBudgetUsd: 999999,
        weeklyBudgetUsd: 999999,
      });
    } else {
      const budgetRef = ref(db, `remoduler/${PROJECT_ID}/overrides`);
      await set(budgetRef, {
        dailyBudgetUsd: settings.dailyBudgetUsd,
        weeklyBudgetUsd: settings.weeklyBudgetUsd,
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const resetBudget = async () => {
    const budgetRef = ref(db, `budgets/${PROJECT_ID}`);
    await set(budgetRef, {
      daily: { date: new Date().toISOString().split('T')[0], spent: 0 },
      weekly: { weekStart: new Date().toISOString().split('T')[0], spent: 0 },
      tokens: { date: new Date().toISOString().split('T')[0], input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) return <div className="dashboard"><div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <div className="dashboard-title">Settings</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Configure Remoduler behavior
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {saved && <span style={{ color: 'var(--success)', fontSize: 13, alignSelf: 'center' }}>Saved</span>}
          <button className="btn btn-primary" onClick={save}>Save Settings</button>
        </div>
      </div>

      {/* Budget */}
      <div className="card">
        <div className="card-header">Budget</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Toggle
            checked={settings.budgetUnlimited}
            onChange={v => update('budgetUnlimited', v)}
            label="Unlimited budget (no daily/weekly limits)"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, opacity: settings.budgetUnlimited ? 0.4 : 1 }}>
            <Field label="Daily Budget (USD)" sub="Remoduler stops when exceeded">
              <Input
                type="number"
                value={settings.dailyBudgetUsd}
                onChange={v => update('dailyBudgetUsd', Number(v))}
                disabled={settings.budgetUnlimited}
              />
            </Field>
            <Field label="Weekly Budget (USD)" sub="Resets every Monday">
              <Input
                type="number"
                value={settings.weeklyBudgetUsd}
                onChange={v => update('weeklyBudgetUsd', Number(v))}
                disabled={settings.budgetUnlimited}
              />
            </Field>
          </div>

          <button className="btn btn-danger" onClick={resetBudget} style={{ alignSelf: 'flex-start' }}>
            Reset Budget Counters
          </button>
        </div>
      </div>

      {/* Review */}
      <div className="card">
        <div className="card-header">Review</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Max Review Cycles" sub="Reviewer ↔ Coder fix loop limit">
            <Input type="number" value={settings.maxReviewCycles} onChange={v => update('maxReviewCycles', Number(v))} />
          </Field>
          <Field label="Auto-Merge">
            <Toggle checked={settings.autoMerge} onChange={v => update('autoMerge', v)} label="Merge PRs automatically after approval" />
          </Field>
        </div>
      </div>

      {/* Agent CLIs */}
      <div className="card">
        <div className="card-header">Agent CLIs</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Field label="Planner">
            <Input value={settings.cliPlanner} onChange={v => update('cliPlanner', v)} />
          </Field>
          <Field label="Architect">
            <Input value={settings.cliArchitect} onChange={v => update('cliArchitect', v)} />
          </Field>
          <Field label="Coder">
            <Input value={settings.cliCoder} onChange={v => update('cliCoder', v)} />
          </Field>
          <Field label="Reviewer">
            <Input value={settings.cliReviewer} onChange={v => update('cliReviewer', v)} />
          </Field>
        </div>
      </div>

      {/* Focus */}
      <div className="card">
        <div className="card-header">Focus</div>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'end' }}>
          <Field label="Focus Phase" sub="Only tasks [X.x] in numerical order">
            <Input value={settings.focusPhase} onChange={v => update('focusPhase', v)} />
          </Field>
          <button
            className="btn"
            onClick={() => update('focusPhase', '')}
            style={{ height: 38 }}
          >
            Clear Focus
          </button>
        </div>
      </div>
    </div>
  );
}
