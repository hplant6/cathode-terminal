import React from 'react';

export function Toast({ children, spinner = false }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '8px', maxWidth: '320px',
      padding: '7px 14px', borderRadius: 'var(--radius-pill)',
      background: 'var(--bg-toolbar)', border: '1px solid var(--accent-border)',
      boxShadow: '0 8px 24px var(--shadow-overlay)',
      fontSize: '11.5px', fontWeight: 600, color: 'var(--accent)',
    }}>
      {spinner && (
        <span style={{
          width: 11, height: 11, flexShrink: 0,
          border: '1.5px solid var(--accent-border)', borderTopColor: 'var(--accent)',
          borderRadius: '50%', animation: 'cds-spin 0.7s linear infinite',
        }} />
      )}
      {children}
      <style>{'@keyframes cds-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
