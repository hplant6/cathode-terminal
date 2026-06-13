import React from 'react';

const variants = {
  info:    { color: 'var(--accent)',  bg: 'var(--accent-dim)',     border: 'var(--accent-border)' },
  success: { color: 'var(--success)', bg: 'rgba(78,201,176,0.12)', border: 'rgba(78,201,176,0.35)' },
  warning: { color: 'var(--warning)', bg: 'rgba(232,168,56,0.12)', border: 'rgba(232,168,56,0.35)' },
  danger:  { color: 'var(--danger)',  bg: 'var(--danger-dim)',     border: 'var(--danger)' },
};

export function Alert({ variant = 'info', title, children, action, onAction }) {
  const v = variants[variant] || variants.info;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', width: '380px',
      padding: '10px 12px', borderRadius: 'var(--radius-md)', background: v.bg, border: '1px solid ' + v.border,
      fontSize: '12px', color: 'var(--text)', lineHeight: 1.45,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <span style={{ color: v.color, fontWeight: 700 }}>{title} </span>}
        {children}
      </div>
      {action && (
        <button
          onClick={onAction}
          style={{
            flexShrink: 0, padding: '5px 12px', background: v.color, border: 'none',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-on-accent)', fontSize: '11px',
            fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >{action}</button>
      )}
    </div>
  );
}
