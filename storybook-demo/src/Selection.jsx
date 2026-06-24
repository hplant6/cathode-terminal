import React from 'react';

// Marching-ants selection outline — matches the in-app element selector.
// 4px orange dash / 3px gap drawn as per-edge gradients (native 'dashed' can't
// size its segments), a soft glow, and a clockwise march.
const KEYFRAMES = `@keyframes cathode-march {
  from { background-position: 0 0, 0 100%, 0 0, 100% 0; }
  to   { background-position: 7px 0, -7px 100%, 0 -7px, 100% 7px; }
}`;
const gradH = 'repeating-linear-gradient(90deg, #FF5720 0 4px, transparent 4px 7px)';
const gradV = 'repeating-linear-gradient(0deg, #FF5720 0 4px, transparent 4px 7px)';

export function Selection({ width = 240, height = 140, label = 'Container: K', children }) {
  return (
    <div style={{ position: 'relative', width, height }}>
      <style>{KEYFRAMES}</style>
      <div style={{
        position: 'absolute', inset: 0, boxSizing: 'border-box', pointerEvents: 'none',
        backgroundColor: 'transparent',
        backgroundImage: [gradH, gradH, gradV, gradV].join(','),
        backgroundPosition: '0 0, 0 100%, 0 0, 100% 0',
        backgroundSize: '100% 1px, 100% 1px, 1px 100%, 1px 100%',
        backgroundRepeat: 'repeat-x, repeat-x, repeat-y, repeat-y',
        boxShadow: '0 0 14px 2px rgba(255,87,32,0.275), 0 0 30px 6px rgba(255,87,32,0.14)',
        animation: 'cathode-march 0.6s linear infinite',
      }} />
      {label && (
        <div style={{
          position: 'absolute', bottom: '100%', left: -1,
          background: '#FF5720', color: '#fff',
          font: '700 10px/16px monospace', padding: '1px 7px',
          borderRadius: '3px 3px 0 0', whiteSpace: 'nowrap',
        }}>{label}</div>
      )}
      {children}
    </div>
  );
}
