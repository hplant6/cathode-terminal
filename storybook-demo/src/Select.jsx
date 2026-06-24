import React, { useState, useRef, useEffect } from 'react';

export function Select({ options = [], defaultValue, placeholder = 'Select…', disabled = false, size = 'md', onChange }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue ?? '');
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selected = options.find((o) => o.value === value);
  const small = size === 'sm';   // smaller dropdown type — used by the box-select tool's property fields

  return (
    <div ref={ref} style={{ position: 'relative', width: small ? '150px' : '220px', opacity: disabled ? 0.5 : 1 }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        style={small ? {
          // Shade-4 fill, no border, signature blob corner at 18px, Zalando 10px uppercase.
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          height: '30px', background: open ? 'var(--spec-structural)' : 'var(--spec-dropdown-bg)', border: 'none',
          borderRadius: '3px 3px 18px 3px', padding: '0 12px', color: 'var(--spec-text-dim)',
          fontFamily: 'var(--font-title)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
          cursor: disabled ? 'default' : 'pointer',
        } : {
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
          background: 'var(--bg-input)', border: '1px solid ' + (open ? 'var(--accent)' : 'var(--border)'),
          borderRadius: 'var(--radius-md)', padding: '8px 10px',
          color: selected ? 'var(--text)' : 'var(--text-dim)',
          font: 'inherit', fontSize: '12px', cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginRight: small ? '3px' : 0 }}>
          <polyline points="2,3.5 5,6.5 8,3.5" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10,
          background: 'var(--bg-toolbar)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px var(--shadow-overlay)', padding: '10px',
          display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '240px', overflowY: 'auto',
        }}>
          {options.map((o) => {
            const sel = o.value === value;
            return (
              <div key={o.value}
                onClick={() => { setValue(o.value); setOpen(false); onChange && onChange(o.value); }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'var(--btn-hover)'; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
                style={{
                  padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                  color: sel ? 'var(--accent)' : 'var(--text)',
                  background: sel ? 'var(--accent-dim)' : 'transparent',
                }}>
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
