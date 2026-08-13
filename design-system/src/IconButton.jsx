import React from 'react';

const variants = {
  default: { color: 'var(--text-dim)', bg: 'transparent',     border: 'transparent' },
  outline: { color: 'var(--text-dim)', bg: 'var(--bg-input)', border: 'var(--border)' },
};

export function IconButton({ icon, label, variant = 'default', active = false, disabled = false, onClick }) {
  const v = variants[variant] || variants.default;
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'var(--accent-dim)' : v.bg,
        border: '1px solid ' + (active ? 'var(--accent)' : v.border),
        borderRadius: 'var(--radius-md)', color: active ? 'var(--accent)' : v.color,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'color 0.12s, background 0.12s, border-color 0.12s',
      }}
    >
      {icon}
    </button>
  );
}
