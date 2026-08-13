import React from 'react';

const variants = {
  accent:  { background: 'var(--accent-dim)', color: 'var(--text)',     border: '1px solid var(--accent-border)' },
  neutral: { background: 'var(--bg-input)',   color: 'var(--text-dim)', border: '1px solid var(--border)' },
};

export function Chip({ label, variant = 'accent', removable = false, onRemove }) {
  const s = variants[variant] || variants.accent;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: removable ? '3px 4px 3px 10px' : '3px 10px',
      borderRadius: 'var(--radius-pill)', fontSize: '11px', fontWeight: 600, ...s,
    }}>
      {label}
      {removable && (
        <button
          onClick={onRemove}
          style={{
            border: 'none', background: 'transparent', color: 'var(--text-dim)',
            cursor: 'pointer', fontSize: '11px', lineHeight: 1, padding: '1px 3px', borderRadius: '4px',
          }}
        >✕</button>
      )}
    </span>
  );
}
