import React, { useState } from 'react';

// `fullWidth` stretches the control to its container with equal-width, taller
// segments (matches the Extract tool's media destination toggle).
export function SegmentedControl({ options = [], defaultValue, onChange, fullWidth = false }) {
  const [value, setValue] = useState(defaultValue ?? (options[0] && options[0].value));
  return (
    <div style={{
      display: fullWidth ? 'flex' : 'inline-flex',
      width: fullWidth ? '100%' : undefined,
      background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: fullWidth ? '6px' : 'var(--radius-pill)', padding: '2px', gap: '2px',
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => { setValue(o.value); onChange && onChange(o.value); }}
            style={{
              flex: fullWidth ? 1 : undefined,
              height: fullWidth ? '28px' : undefined,
              border: 'none', borderRadius: fullWidth ? '5px' : 'var(--radius-pill)',
              padding: fullWidth ? '0' : '5px 14px',
              fontSize: fullWidth ? '11.5px' : '12px', fontWeight: 600, cursor: 'pointer',
              background: active ? 'var(--accent-dim)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-dim)',
              boxShadow: active && fullWidth ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
