import React from 'react';

// Semicircle gauge (speedometer) with the usage-panel threshold colors.
export function Gauge({ value = 0, max = 100, label, sublabel, color }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--accent)';
  const fill = color || auto;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <svg width="58" height="35" viewBox="0 0 80 48" style={{ flexShrink: 0 }}>
        <path d="M8,44 A32,32 0 0 1 72,44" fill="none" stroke="var(--bg-input)" strokeWidth="7" strokeLinecap="round" pathLength="100" />
        <path d="M8,44 A32,32 0 0 1 72,44" fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round"
          pathLength="100" strokeDasharray={`${pct} 100`} style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }} />
        <text x="40" y="43" textAnchor="middle" style={{ fill: 'var(--text)', fontSize: '15px', fontWeight: 800 }}>{Math.round(pct)}%</text>
      </svg>
      {(label || sublabel) && (
        <div>
          {label && <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{label}</div>}
          {sublabel && <div style={{ fontSize: '9.5px', color: 'var(--text-dim)' }}>{sublabel}</div>}
        </div>
      )}
    </div>
  );
}
