import React, { useState } from 'react';

const placements = {
  top:    { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
  bottom: { top: 'calc(100% + 6px)',    left: '50%', transform: 'translateX(-50%)' },
  right:  { left: 'calc(100% + 6px)',   top: '50%',  transform: 'translateY(-50%)' },
  left:   { right: 'calc(100% + 6px)',  top: '50%',  transform: 'translateY(-50%)' },
};

export function Tooltip({ text, placement = 'top', children }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute', ...(placements[placement] || placements.top), zIndex: 20,
          maxWidth: '220px', padding: '7px 10px',
          background: '#161616', border: '1px solid #2e2e2e', borderRadius: '6px',
          boxShadow: '0 10px 32px rgba(0,0,0,0.6)',
          fontSize: '11px', lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'normal', pointerEvents: 'none',
        }}>{text}</span>
      )}
    </span>
  );
}
