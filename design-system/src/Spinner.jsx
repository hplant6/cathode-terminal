import React from 'react';

export function Spinner({ size = 16, color = 'var(--accent)', label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-dim)' }}>
      <span style={{
        width: size, height: size, borderRadius: '50%',
        border: Math.max(1.5, size / 8) + 'px solid var(--border)',
        borderTopColor: color, display: 'inline-block',
        animation: 'cds-spin 0.7s linear infinite',
      }} />
      {label}
      <style>{'@keyframes cds-spin { to { transform: rotate(360deg); } }'}</style>
    </span>
  );
}
