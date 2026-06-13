import React, { useState } from 'react';

export function Input({
  label,
  placeholder = '',
  type = 'text',
  helpText,
  error,
  disabled = false,
  defaultValue = '',
  prefix,
  suffix,
}) {
  const [value, setValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? 'var(--danger)'
    : focused
    ? 'var(--accent)'
    : 'var(--border)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '280px' }}>
      {label && (
        <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label}
        </label>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-input)',
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 0.15s',
        opacity: disabled ? 0.45 : 1,
      }}>
        {prefix && (
          <span style={{ padding: '0 8px', color: 'var(--text-dim)', fontSize: '12px', borderRight: '1px solid var(--border)' }}>
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={e => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            padding: '7px 10px',
            color: 'var(--text)',
            fontSize: '12px',
            fontFamily: 'var(--font-ui)',
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        {suffix && (
          <span style={{ padding: '0 8px', color: 'var(--text-dim)', fontSize: '12px', borderLeft: '1px solid var(--border)' }}>
            {suffix}
          </span>
        )}
      </div>
      {(helpText || error) && (
        <span style={{ fontSize: '11px', color: error ? 'var(--danger)' : 'var(--text-dim)' }}>
          {error || helpText}
        </span>
      )}
    </div>
  );
}
