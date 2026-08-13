import React, { useState, useRef, useEffect } from 'react';

// The app's canonical dropdown (.ct-select in styles.css). Every <select> in Cathode
// is routed through it by enhanceSelect(), so this is the only dropdown type — the
// `size` prop is the same control on a different surface, not a different component.
//   md — default, 32px, sits on a panel
//   sm — 30px, inline in the Box Select property rows
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
  const small = size === 'sm';

  return (
    <div ref={ref} style={{ position: 'relative', width: small ? '150px' : '220px', opacity: disabled ? 0.5 : 1 }}>
      {/* .ct-select-btn — shade-4 fill, no border, signature blob corner, Zalando uppercase */}
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width: '100%', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          minHeight: small ? '30px' : '32px', padding: '0 12px',
          background: open ? 'var(--spec-text-faint)' : 'var(--spec-dropdown-bg)',
          border: 'none', borderRadius: '3px 3px var(--r-blob-sm, 18px) 3px',
          color: open ? 'var(--spec-text)' : 'var(--spec-text-dim)',
          fontFamily: 'var(--font-title)', fontStretch: '112.5%', fontWeight: 600,
          fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
          textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
          transition: 'background 0.12s, color 0.12s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        {/* .ct-select-chev */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, color: 'var(--spec-text-dim)' }}>
          <polyline points="2,3.5 5,6.5 8,3.5" />
        </svg>
      </button>
      {open && (
        // .ct-select-menu — shade-7 surface, shade-6 hairline
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10, boxSizing: 'border-box',
          background: 'var(--spec-input-bg)', border: '1px solid var(--spec-header-bg)',
          borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px',
          maxHeight: '260px', overflowY: 'auto',
        }}>
          {options.map((o) => {
            const sel = o.value === value;
            return (
              // .ct-select-opt — mono, selected row takes the accent
              <div key={o.value}
                onClick={() => { setValue(o.value); setOpen(false); onChange && onChange(o.value); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--spec-header-bg)'; e.currentTarget.style.color = sel ? 'var(--spec-accent)' : 'var(--spec-text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = sel ? 'var(--spec-header-bg)' : 'transparent'; e.currentTarget.style.color = sel ? 'var(--spec-accent)' : 'var(--spec-text)'; }}
                style={{
                  flexShrink: 0, padding: '8px 10px', borderRadius: '5px', cursor: 'pointer',
                  fontSize: '12px', fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  color: sel ? 'var(--spec-accent)' : 'var(--spec-text)',
                  background: sel ? 'var(--spec-header-bg)' : 'transparent',
                  transition: 'background 0.12s, color 0.12s',
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
