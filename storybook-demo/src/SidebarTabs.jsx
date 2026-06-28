import React, { useState } from 'react';

// Vertical "underline" tabs (e.g. the theme selector sidebar). Geist Mono Black,
// all caps, no corner radius. Inactive: shade-1 text. Hover: shade-2 underline.
// Active: orange underline + white text + check.
const STYLES = `
.sb-vtab {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; padding: 8px 0;
  border: none; border-bottom: 1px solid transparent; border-radius: 0;
  background: none; color: var(--spec-text-dim);
  font-family: var(--font-mono); font-size: 13px; font-weight: 900;   /* Geist Mono Black */
  text-transform: uppercase; letter-spacing: 0.04em; text-align: left; cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.sb-vtab:hover  { color: var(--spec-text); border-bottom-color: var(--spec-text-faint); }   /* shade 2 */
.sb-vtab.active { color: var(--spec-text); border-bottom-color: var(--spec-accent); }       /* orange */
.sb-vtab-check  { font-size: 12px; }
`;

export function SidebarTabs({ tabs = ['Default', 'Khaki', 'Custom'], defaultActive = 0 }) {
  const [active, setActive] = useState(defaultActive);
  return (
    <div style={{ width: 176, display: 'flex', flexDirection: 'column' }}>
      <style>{STYLES}</style>
      {tabs.map((t, i) => (
        <button key={t} className={'sb-vtab' + (i === active ? ' active' : '')} onClick={() => setActive(i)}>
          <span>{t}</span>
          {i === active && (
            <svg className="sb-vtab-check" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6.5 5,9 10,3" /></svg>
          )}
        </button>
      ))}
    </div>
  );
}
