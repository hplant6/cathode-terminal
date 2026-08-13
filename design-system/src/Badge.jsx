import React from 'react';

const variantStyles = {
  default: { background: 'var(--btn-hover)',   color: '#fff',  border: '1px solid var(--border)' },
  accent:  { background: 'var(--accent-dim)',  color: 'var(--accent)',    border: '1px solid var(--accent-border)' },
  success: { background: 'rgba(78,201,176,.15)', color: 'var(--success)', border: '1px solid rgba(78,201,176,.3)' },
  danger:  { background: 'var(--danger-dim)',  color: 'var(--danger)',    border: '1px solid var(--danger)' },
  warning: { background: 'rgba(232,168,56,.15)', color: 'var(--warning)', border: '1px solid rgba(232,168,56,.3)' },
};

export function Badge({ label, variant = 'default', dot = false }) {
  const s = variantStyles[variant] || variantStyles.default;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '2px 8px',
      borderRadius: '3px',
      fontSize: '11px',
      fontFamily: 'var(--font-mono)',   // Geist Mono
      fontWeight: 900,                  // Black
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
      ...s,
    }}>
      {dot && (
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: 'currentColor', flexShrink: 0,
        }} />
      )}
      {label}
    </span>
  );
}
