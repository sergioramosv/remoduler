'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: '⬡' },
  { href: '/analytics', label: 'Analytics', icon: '◈' },
  { href: '/history', label: 'History', icon: '☰' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside style={{
      width: collapsed ? 56 : 220,
      minHeight: '100vh',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease',
      position: 'fixed',
      left: 0,
      top: 0,
      bottom: 0,
      zIndex: 100,
    }}>
      {/* Brand */}
      <div style={{
        padding: collapsed ? '16px 12px' : '20px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        {!collapsed && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--accent)' }}>
              Remoduler
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              AI Orchestrator
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 16,
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '◂'}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '10px 12px' : '10px 12px',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                background: isActive ? 'var(--bg-accent)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--border-active)' : 'transparent'}`,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>
                {item.icon}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Version */}
      <div style={{ marginTop: 'auto', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        {!collapsed && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            v1.0.0
          </div>
        )}
      </div>
    </aside>
  );
}
