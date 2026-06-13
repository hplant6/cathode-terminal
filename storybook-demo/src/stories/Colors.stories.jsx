import React from 'react';

export default {
  title: 'Cathode Design System / Colors',
  parameters: { layout: 'padded' },
};

const palette = [
  { name: 'bg-base',        value: '#1a1a1a', var: '--bg-base',       label: 'App background' },
  { name: 'bg-panel',       value: '#1e1e1e', var: '--bg-panel',      label: 'Panel / sidebar' },
  { name: 'bg-toolbar',     value: '#252525', var: '--bg-toolbar',    label: 'Toolbar / header' },
  { name: 'bg-input',       value: '#2d2d2d', var: '--bg-input',      label: 'Input fields, picks' },
  { name: 'border',         value: '#333333', var: '--border',        label: 'All borders' },
  { name: 'text',           value: '#cccccc', var: '--text',          label: 'Primary text' },
  { name: 'text-dim',       value: '#666666', var: '--text-dim',      label: 'Muted / secondary text' },
  { name: 'accent',         value: '#4a9eff', var: '--accent',        label: 'Brand blue — active states, focus rings' },
  { name: 'accent-hover',   value: '#7ab8ff', var: '--accent-hover',  label: 'Accent on hover' },
  { name: 'accent-dark',    value: '#3a8eef', var: '--accent-dark',   label: 'Accent on press' },
  { name: 'danger',         value: '#f44747', var: '--danger',        label: 'Errors, destructive actions' },
  { name: 'success',        value: '#4ec9b0', var: '--success',       label: 'Positive feedback, connected state' },
  { name: 'warning',        value: '#e8a838', var: '--warning',       label: 'Warnings, caution' },
  { name: 'btn-hover',      value: '#3a3a3a', var: '--btn-hover',     label: 'Button hover background' },
  { name: 'btn-active',     value: '#444444', var: '--btn-active',    label: 'Button press background' },
];

function Swatch({ name, value, varName, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 0', borderBottom: '1px solid #2a2a2a' }}>
      <div style={{ width: 40, height: 40, borderRadius: 6, background: value, border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#cccccc', fontFamily: 'monospace' }}>{varName}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{label}</div>
      </div>
      <code style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', flexShrink: 0 }}>{value}</code>
    </div>
  );
}

export const AllColors = {
  render: () => (
    <div style={{ width: 560, padding: '0 4px' }}>
      <h2 style={{ color: '#ccc', fontSize: 13, fontWeight: 700, marginBottom: 16, fontFamily: 'system-ui' }}>
        Color Palette
      </h2>
      {palette.map(c => <Swatch key={c.name} name={c.name} value={c.value} varName={c.var} label={c.label} />)}
    </div>
  ),
  name: 'All Colors',
};
