import React, { useState } from 'react';

// "small text toggle tabs" (Figma) — a sliding switch.
// A shade-7 thumb slides under the active option; inactive labels are shade 2
// and brighten to shade 1 on hover. Labels render in Zalando SemiExpanded
// uppercase. Works with 2+ options.
export function TextToggle({ options = [], defaultValue, onChange }) {
  const [value, setValue]   = useState(defaultValue ?? (options[0] && options[0].value));
  const [hovered, setHover] = useState(null);

  const n   = options.length || 1;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${n}, 1fr)`,
        width: 'max-content',
        background: '#000000',          // Black container
        borderRadius: '5px',
        padding: '2px',
      }}
    >
      {/* Sliding background — sits under the active option */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          bottom: 2,
          left: 2,
          width: `calc((100% - 4px) / ${n})`,
          transform: `translateX(calc(${idx} * 100%))`,
          background: 'var(--spec-input-bg)',   // shade 7
          borderRadius: '3px',
          transition: 'transform 0.34s cubic-bezier(0.45,0.05,0.2,1)',
          pointerEvents: 'none',
        }}
      />
      {options.map((o) => {
        const lit = o.value === value || hovered === o.value;   // active or hovered → shade 1
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => { setValue(o.value); onChange && onChange(o.value); }}
            onMouseEnter={() => setHover(o.value)}
            onMouseLeave={() => setHover(null)}
            style={{
              position: 'relative',
              zIndex: 1,                          // text rides above the thumb
              background: 'transparent',
              border: 'none',
              borderRadius: '3px',
              padding: '3px 9px',
              cursor: 'pointer',
              fontFamily: 'var(--font-title)',    // Zalando SemiExpanded
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: lit ? 'var(--spec-text-dim)' : 'var(--spec-text-faint)',
              transition: 'color 0.18s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
