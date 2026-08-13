import React from 'react';

// Threshold colors mirror the usage panel: accent < 70% < amber < 90% < red.
export function ProgressBar({ value = 0, max = 100, label, showValue = true, color, width = '280px' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--accent)';
  const fill = color || auto;
  return (
    <div style={{ width, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {(label || showValue) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
          {label && <span style={{ color: 'var(--text)', fontWeight: 600 }}>{label}</span>}
          {showValue && (
            <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
          )}
        </div>
      )}
      <div style={{ height: '7px', borderRadius: '4px', background: 'var(--bg-input)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: fill, borderRadius: '4px', transition: 'width 0.35s ease' }} />
      </div>
    </div>
  );
}
