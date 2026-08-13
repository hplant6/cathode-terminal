import React from 'react';

// Outlined "add" button (full-width). Static: shade-2 border, no fill, shade-1
// text. Hover: orange border, no fill, white text. Zalando SemiExpanded, all caps.
// Used for "+ Add …" rows in modals.
const STYLES = `
.sb-add-btn {
  width: 100%; height: 32px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid var(--spec-text-faint);    /* shade 2 */
  border-radius: var(--radius-md);
  color: var(--spec-text-dim);                  /* shade 1 */
  font-family: var(--font-title); font-stretch: 112.5%;
  font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.sb-add-btn:hover {
  border-color: var(--spec-accent);             /* orange */
  color: var(--spec-text);                      /* white */
}
`;

export function AddButton({ label = '+ Add Prompt', onClick }) {
  return (
    <>
      <style>{STYLES}</style>
      <button className="sb-add-btn" type="button" onClick={onClick}>{label}</button>
    </>
  );
}
