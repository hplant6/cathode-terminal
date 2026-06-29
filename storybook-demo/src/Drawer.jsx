import React from 'react';

// Collapsible "context drawer" — used in chat to tuck tool-injected content
// (CSS, logs, code, page context) out of the way. Closed: no fill, shade-3
// border, 22px radius. Open: shade-7 fill fades in while the border fades out.
// Zalando-uppercase label with an orange chevron on hover.
const STYLES = `
.sb-drawer {
  margin: 0; box-sizing: border-box;
  background: transparent; border: 1px solid var(--spec-structural); border-radius: 22px;   /* closed: shade-3 border, no fill */
  overflow: hidden; transition: background 0.3s ease, border-color 0.3s ease;
}
.sb-drawer[open] { background: var(--spec-input-bg); border-color: transparent; }            /* open: fill in, border out */
.sb-drawer > summary {
  list-style: none; cursor: pointer; -webkit-user-select: none; user-select: none;
  padding: 10px 16px; color: var(--spec-text-dim);
  font-family: var(--font-title); font-stretch: 112.5%; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  display: flex; align-items: center; gap: 6px;
}
.sb-drawer > summary::-webkit-details-marker { display: none; }
.sb-drawer > summary::before {
  content: ''; display: inline-block; flex-shrink: 0; width: 10px; height: 10px; background: var(--spec-text-faint);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='M15.8154 5.93451C16.1278 6.24693 16.1278 6.75295 15.8154 7.06537L9.56543 13.3154C9.25301 13.6278 8.74699 13.6278 8.43457 13.3154L2.18457 7.06537C1.87215 6.75295 1.87215 6.24693 2.18457 5.93451C2.49699 5.62209 3.00301 5.62209 3.31543 5.93451L9 11.6191L14.6846 5.93451C14.997 5.62209 15.503 5.62209 15.8154 5.93451Z'/%3E%3C/svg%3E") no-repeat center / contain;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='M15.8154 5.93451C16.1278 6.24693 16.1278 6.75295 15.8154 7.06537L9.56543 13.3154C9.25301 13.6278 8.74699 13.6278 8.43457 13.3154L2.18457 7.06537C1.87215 6.75295 1.87215 6.24693 2.18457 5.93451C2.49699 5.62209 3.00301 5.62209 3.31543 5.93451L9 11.6191L14.6846 5.93451C14.997 5.62209 15.503 5.62209 15.8154 5.93451Z'/%3E%3C/svg%3E") no-repeat center / contain;
  transform: rotate(-90deg); transition: transform 0.12s, background 0.12s;
}
.sb-drawer[open] > summary::before { transform: rotate(0deg); }
.sb-drawer > summary:hover { color: var(--spec-text); }
.sb-drawer > summary:hover::before { background: var(--spec-accent); }     /* orange chevron on hover */
.sb-drawer > pre {
  margin: 0; padding: 12px 18px; border-top: 1px solid var(--spec-header-bg);   /* shade-6 divider */
  font-family: var(--font-mono); font-size: 11px; line-height: 1.5; color: var(--spec-text-dim);
  white-space: pre-wrap; word-break: break-word; text-align: left;
  max-height: 320px; overflow: auto;
}
`;

export function Drawer({ label = 'Element Context', children = '', defaultOpen = false }) {
  return (
    <>
      <style>{STYLES}</style>
      <details className="sb-drawer" open={defaultOpen}>
        <summary>{label}</summary>
        <pre>{children}</pre>
      </details>
    </>
  );
}
