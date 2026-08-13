import React from 'react';

export function Card({ title, description, icon, selected = false, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: '220px', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start',
        padding: '16px', textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
        background: selected ? 'var(--accent-dim)' : 'var(--bg-input)',
        border: '1px solid ' + (selected ? 'var(--accent-border)' : 'var(--border)'),
        borderRadius: 'var(--radius-md)', transition: 'border-color 0.12s, background 0.12s',
      }}
    >
      {icon && <div style={{ color: 'var(--accent)', marginBottom: '4px' }}>{icon}</div>}
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      {description && (
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', lineHeight: 1.4 }}>{description}</span>
      )}
    </div>
  );
}
