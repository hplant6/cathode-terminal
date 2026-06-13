import React, { useState } from 'react';

export function SegmentedControl({ options = [], defaultValue, onChange }) {
  const [value, setValue] = useState(defaultValue ?? (options[0] && options[0].value));
  return (
    <div style={{
      display: 'inline-flex', background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)', padding: '2px', gap: '2px',
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => { setValue(o.value); onChange && onChange(o.value); }}
            style={{
              border: 'none', borderRadius: 'var(--radius-pill)', padding: '5px 14px',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              background: active ? 'var(--accent-dim)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-dim)',
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
