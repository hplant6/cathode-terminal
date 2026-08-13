import React from 'react';

const variants = {
  primary: {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
    border: 'none',
    hoverBg: 'var(--accent-hover)',
  },
  secondary: {
    background: 'var(--btn-hover)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    hoverBg: 'var(--btn-active)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-dim)',
    border: '1px solid var(--border)',
    hoverBg: 'var(--btn-hover)',
  },
  danger: {
    background: 'var(--danger-dim)',
    color: 'var(--danger)',
    border: '1px solid var(--danger)',
    hoverBg: 'rgba(244,71,71,0.28)',
  },
};

const sizes = {
  sm: { height: '26px', padding: '0 10px', fontSize: '11px' },
  md: { height: '30px', padding: '0 14px', fontSize: '12px' },
  lg: { height: '36px', padding: '0 18px', fontSize: '13px' },
};

export function Button({ label, variant = 'primary', size = 'md', disabled = false, onClick }) {
  const v = variants[variant] || variants.primary;
  const s = sizes[size] || sizes.md;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        height: s.height,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: 600,
        fontFamily: 'var(--font-ui)',
        background: v.background,
        color: disabled ? 'var(--text-dim)' : v.color,
        border: v.border,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.1s, color 0.1s, opacity 0.1s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
