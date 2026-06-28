import React, { useState } from 'react';

// Multiline input (textarea). Dark / address-bar style: shade-7 fill, shade-3
// border, focus → shade-1 border + shade-5 fill. Vertically resizable with a
// custom corner glyph (lower-right). Defaults to 4 rows.
const STYLES = `
.sb-textarea {
  width: 100%; box-sizing: border-box;
  background: var(--spec-input-bg);      /* shade 7 */
  border: 1px solid var(--border);       /* shade 3 */
  border-radius: var(--radius-md);
  padding: 7px 10px;
  color: var(--spec-text);
  font-size: 12px; font-family: var(--font-mono); line-height: 1.55;
  outline: none; resize: vertical;
  transition: border-color 0.15s, background 0.15s;
}
.sb-textarea:focus { border-color: var(--spec-text-dim); background: var(--spec-toolbar-bg); }
.sb-textarea::-webkit-resizer {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cg fill='none' stroke='%23817E89' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='8.25,14.25 3.75,14.25 3.75,9.75'/%3E%3Cpolyline points='9.75,3.75 14.25,3.75 14.25,8.25'/%3E%3C/g%3E%3C/svg%3E");
  background-position: center; background-repeat: no-repeat; background-size: 12px 12px;
}
`;

export function Textarea({ label, placeholder = '', rows = 4, defaultValue = '' }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '280px' }}>
      <style>{STYLES}</style>
      {label && (
        <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label}
        </label>
      )}
      <textarea
        className="sb-textarea"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={e => setValue(e.target.value)}
      />
    </div>
  );
}
