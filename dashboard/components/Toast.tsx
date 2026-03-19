'use client';

import { useState, useEffect, useRef } from 'react';
import type { HistoryEntry } from '@/lib/types';
import { HISTORY_ICONS } from '@/lib/types';

interface ToastItem {
  id: number;
  entry: HistoryEntry;
}

export function ToastContainer({ history }: { history: HistoryEntry[] }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastTimestamp = useRef(0);
  const idCounter = useRef(0);

  useEffect(() => {
    // Only show toasts for new entries
    const newEntries = history.filter(e => e.timestamp > lastTimestamp.current);
    if (newEntries.length > 0) {
      lastTimestamp.current = Math.max(...newEntries.map(e => e.timestamp));

      const newToasts = newEntries.slice(0, 3).map(entry => ({
        id: ++idCounter.current,
        entry,
      }));

      setToasts(prev => [...newToasts, ...prev].slice(0, 5));

      // Auto-remove after 5 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => !newToasts.includes(t)));
      }, 5000);
    }
  }, [history]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(({ id, entry }) => (
        <div key={id} className="toast">
          <span className="toast-icon">{HISTORY_ICONS[entry.action] || '•'}</span>
          <div style={{ flex: 1 }}>
            <div className="toast-message">{entry.message}</div>
            <div className="toast-time">{new Date(entry.timestamp).toLocaleTimeString('es-ES')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
