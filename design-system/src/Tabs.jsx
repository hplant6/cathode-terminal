import React, { useState } from 'react';

export function Tabs({ tabs = [], defaultValue, onChange }) {
  const [value, setValue] = useState(defaultValue ?? (tabs[0] && tabs[0].value));
  return (
    <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--border)' }}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => { setValue(t.value); onChange && onChange(t.value); }}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              padding: '8px 14px', fontSize: '12px', fontWeight: 600,
              color: active ? 'var(--text)' : 'var(--text-dim)',
              borderBottom: '2px solid ' + (active ? 'var(--accent)' : 'transparent'),
              marginBottom: '-1px', transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
