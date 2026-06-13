import React, { useState } from 'react';

export function Checkbox({ label, defaultChecked = false, disabled = false, onChange }) {
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
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, userSelect: 'none',
        fontSize: '12px', color: 'var(--text)',
      }}
    >
      <span style={{
        width: '16px', height: '16px', flexShrink: 0, borderRadius: '4px',
        background: on ? 'var(--accent)' : 'var(--bg-input)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.12s, border-color 0.12s',
      }}>
        {on && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--text-on-accent)"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,6.5 5,9 10,3" />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}
