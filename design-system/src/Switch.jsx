import React, { useState } from 'react';

export function Switch({ defaultChecked = false, disabled = false, label, onChange }) {
  const [on, setOn] = useState(defaultChecked);
  const toggle = () => {
    if (disabled) return;
    const v = !on;
    setOn(v);
    onChange && onChange(v);
  };
  return (
    <label
      onClick={toggle}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, userSelect: 'none',
      }}
    >
      <span style={{
        width: '34px', height: '20px', borderRadius: 'var(--radius-pill)', flexShrink: 0, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--bg-input)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
        transition: 'background 0.15s, border-color 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: '2px', left: on ? '15px' : '2px',
          width: '14px', height: '14px', borderRadius: '50%',
          background: on ? 'var(--text-on-accent)' : 'var(--text-dim)',
          transition: 'left 0.15s, background 0.15s',
        }} />
      </span>
      {label && <span style={{ fontSize: '12px', color: 'var(--text)' }}>{label}</span>}
    </label>
  );
}
