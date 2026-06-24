import React from 'react';

// Shared tool-panel footer (used across every menu): the instructions input
// with a drag-to-resize handle, over a Cancel / Send bar with blob corners.
const STYLES = `
.tpf { position: relative; border-top: 1px solid var(--spec-structural); }
.tpf-input {
  display: block; width: 100%; box-sizing: border-box; min-height: 72px; resize: none;
  background: var(--spec-input-bg); color: var(--spec-text); border: none; border-radius: 0;
  font: 12px/1.5 var(--font-mono); padding: 12px 28px 12px 14px; outline: none;
}
.tpf-input::placeholder { color: var(--spec-structural); }
.tpf-resize {
  position: absolute; top: 10px; right: 10px; background: transparent; border: none; padding: 0;
  color: var(--spec-text-faint); cursor: ns-resize; display: flex; transition: color 0.12s;
}
.tpf-resize:hover { color: var(--spec-text); }
.tpf-bar { display: flex; align-items: stretch; gap: 2px; min-height: 40px; background: var(--spec-toolbar-bg); border-radius: 0 0 22px 22px; }
.tpf-btn {
  flex: 1; align-self: stretch; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-title); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  transition: background 0.12s, color 0.12s;
}
.tpf-cancel { background: var(--spec-dropdown-bg); color: var(--spec-text-dim); border-radius: 0 0 0 22px; }
.tpf-cancel:hover { background: var(--spec-structural); color: var(--spec-text); }
.tpf-send { background: #4C2112; color: var(--spec-text-dim); border-radius: 0 0 22px 0; }
.tpf-send:hover { background: #FF5720; color: #fff; }
`;

export function PanelFooter({ placeholder = 'type instructions here', cancelLabel = 'Cancel', sendLabel = 'Send' }) {
  return (
    <div className="tpf">
      <style>{STYLES}</style>
      <textarea className="tpf-input" placeholder={placeholder} />
      <button className="tpf-resize" title="Drag to resize input">
        <svg viewBox="0 0 18 18" width="14" height="14"><g strokeLinecap="round" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.25"><polyline points="8.25 14.25 3.75 14.25 3.75 9.75" /><polyline points="9.75 3.75 14.25 3.75 14.25 8.25" /></g></svg>
      </button>
      <div className="tpf-bar">
        <button className="tpf-btn tpf-cancel">{cancelLabel}</button>
        <button className="tpf-btn tpf-send">{sendLabel}</button>
      </div>
    </div>
  );
}
