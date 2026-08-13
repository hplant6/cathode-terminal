import React from 'react';

export function EmptyState({ icon, title, description, children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      maxWidth: '440px', padding: '24px', margin: '0 auto',
    }}>
      {icon && <div style={{ color: 'var(--accent)', marginBottom: '16px' }}>{icon}</div>}
      <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>{title}</div>
      {description && (
        <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: '20px' }}>{description}</div>
      )}
      {children}
    </div>
  );
}
