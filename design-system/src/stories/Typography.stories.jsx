import React from 'react';

export default {
  title: 'Cathode Design System / Typography',
  parameters: { layout: 'padded' },
};

const scale = [
  { name: 'Display',   size: '18px', weight: 700, family: 'var(--font-ui)',   usage: 'Modal titles, section headers' },
  { name: 'Heading',   size: '14px', weight: 600, family: 'var(--font-ui)',   usage: 'Panel titles, group labels' },
  { name: 'Body',      size: '13px', weight: 400, family: 'var(--font-ui)',   usage: 'Default text, descriptions' },
  { name: 'Label',     size: '12px', weight: 600, family: 'var(--font-ui)',   usage: 'Button labels, nav items' },
  { name: 'Caption',   size: '11px', weight: 400, family: 'var(--font-ui)',   usage: 'Timestamps, help text' },
  { name: 'Overline',  size: '10px', weight: 700, family: 'var(--font-ui)',   usage: 'Section chips, field titles (uppercase + tracking)', transform: 'uppercase', spacing: '0.08em' },
  { name: 'Code',      size: '12px', weight: 400, family: 'var(--font-mono)', usage: 'Inline code, paths, keys' },
  { name: 'Code Dim',  size: '11px', weight: 400, family: 'var(--font-mono)', usage: 'Prompt preview, secondary terminal output', color: 'var(--text-dim)' },
];

export const TypeScale = {
  render: () => (
    <div style={{ width: 560 }}>
      <h2 style={{ color: '#ccc', fontSize: 13, fontWeight: 700, marginBottom: 16, fontFamily: 'system-ui' }}>Type Scale</h2>
      {scale.map(t => (
        <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ width: 80, flexShrink: 0 }}>
            <span style={{
              fontFamily: t.family,
              fontSize: t.size,
              fontWeight: t.weight,
              color: t.color || 'var(--text)',
              textTransform: t.transform,
              letterSpacing: t.spacing,
            }}>
              {t.name}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
              {t.size} / {t.weight} / {t.family.split(',')[0]}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{t.usage}</div>
          </div>
        </div>
      ))}
    </div>
  ),
  name: 'Type Scale',
};
