import React, { useState } from 'react';

// Building blocks of the in-app Box Select tool, styled with the spec ramp.

// ── Checkbox ── 24px square; shade-3 unchecked (orange border on hover),
// orange + white check when selected.
export function PropertyCheckbox({ defaultChecked = false, onChange }) {
  const [on, setOn] = useState(defaultChecked);
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => { const v = !on; setOn(v); onChange && onChange(v); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: 24, height: 24, padding: 0, flexShrink: 0, borderRadius: 5, boxShadow: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? '#FF5720' : 'var(--spec-structural)',
        border: '1.5px solid ' + (on || hover ? '#FF5720' : 'transparent'),
        transition: 'background 0.12s, border-color 0.12s',
      }}>
      {on && (
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
          <path d="M1 7L5 11L13 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// ── Dropdown ── the field control: shade-4, blob corner, Zalando 10px uppercase.
export function PropertyDropdown({ value = 'Flex', width = 135 }) {
  return (
    <button style={{
      width, height: 30, boxShadow: 'none', cursor: 'pointer', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      background: 'var(--spec-dropdown-bg)', border: 'none', borderRadius: '3px 3px 18px 3px', padding: '0 12px',
      fontFamily: 'var(--font-title)', fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--spec-text-dim)',
    }}>
      <span>{value}</span>
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3 }}><polyline points="2,4.5 6,8.5 10,4.5" /></svg>
    </button>
  );
}

// ── Text/length input ── 135px, shade-7, shade-3 border.
export function PropertyInput({ value = '1234px', width = 135 }) {
  return (
    <input readOnly value={value} style={{
      width, height: 30, boxSizing: 'border-box', flexShrink: 0,
      background: 'var(--spec-input-bg)', border: '1px solid var(--spec-structural)', borderRadius: 4,
      color: 'var(--spec-text)', font: '11px var(--font-mono)', padding: '0 8px', outline: 'none',
    }} />
  );
}

// ── Slider ── shade-5 track (10px) + shade-2 pill knob with grip dots.
export function PropertySlider({ width = 130 }) {
  return (
    <div style={{ width, height: 10, background: 'var(--spec-toolbar-bg)', borderRadius: 999, position: 'relative', flexShrink: 0 }}>
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 18, height: 30, borderRadius: 999, background: 'var(--spec-text-faint)', cursor: 'grab',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 18 18" fill="#817E89">
          {[3.75, 9, 14.25].flatMap(cy => [6.75, 11.25].map(cx => (
            <circle key={cx + '-' + cy} cx={cx} cy={cy} r="1.1" />
          )))}
        </svg>
      </div>
    </div>
  );
}

// ── Property row ── checkbox + title + control. Selected → orange title + shade-6 fill.
export function PropertyRow({ label = 'Display', selected = false, control }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, height: 56, padding: '0 12px',
      borderBottom: '1px solid ' + (selected ? 'var(--spec-input-bg)' : 'var(--spec-header-bg)'),
      background: selected ? 'var(--spec-header-bg)' : 'transparent',
    }}>
      <span style={{ marginRight: 3, display: 'flex' }}><PropertyCheckbox defaultChecked={selected} /></span>
      <span style={{ flex: 1, minWidth: 0, font: '600 16px var(--font-mono)', color: selected ? '#FF5720' : 'var(--spec-text-dim)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{control || <PropertyDropdown />}</div>
    </div>
  );
}

// ── Drawer ── element accordion: chevron + descriptor:title + count + ✕, optional body.
export function Drawer({ descriptor = 'Container', name = 'K', count = 0, open = false, children }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div style={{ borderBottom: '1px solid var(--spec-header-bg)' }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 55, padding: '0 12px', cursor: 'pointer',
        background: 'var(--spec-toolbar-bg)',
      }}>
        <svg width="10" height="10" viewBox="0 0 18 18" fill="var(--spec-text-dim)"
          style={{ transform: isOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 0.12s', flexShrink: 0 }}>
          <path d="M15.8 5.9a.9.9 0 0 1 0 1.2l-6.2 6.2a.9.9 0 0 1-1.2 0L2.2 7.1a.85.85 0 0 1 1.1-1.2L9 11.6l5.7-5.7a.85.85 0 0 1 1.1 0Z" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-title)', fontWeight: 600, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--spec-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ font: '600 12px var(--font-mono)', letterSpacing: 0, color: 'var(--spec-text-dim)' }}>{descriptor}: </span>{name}
        </span>
        <span style={{ flexShrink: 0, font: '11px var(--font-mono)', color: 'var(--spec-text-dim)', marginRight: 6 }}>{count} Selected</span>
        <button style={{ background: 'transparent', border: 'none', color: 'var(--spec-text-dim)', cursor: 'pointer', fontSize: 11, padding: '2px 5px' }}>✕</button>
      </div>
      {isOpen && <div style={{ background: 'var(--spec-input-bg)' }}>{children}</div>}
    </div>
  );
}
