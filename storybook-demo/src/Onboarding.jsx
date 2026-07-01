import React from 'react';
import './Onboarding.css';

/* Square fill-and-flip loader — running-step indicator, tinted with the app orange. */
export function StepLoader({ size = 15, color = '#FF5720' }) {
  const border = Math.max(2, Math.round(size / 7.5));
  return (
    <span className="ob-loader" style={{ width: size, height: size, border: `${border}px solid ${color}` }}>
      <span className="ob-loader-inner" style={{ background: color }} />
    </span>
  );
}

/* Checkmark — the app's own icon (src/icons/check.svg). */
const Check = () => (
  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 7L5 11L13 1" />
  </svg>
);
const Cross = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3L9 9M9 3L3 9" />
  </svg>
);

function StepIcon({ state }) {
  if (state === 'running') return <span className="ob-step-ic"><StepLoader /></span>;
  if (state === 'done')    return <span className="ob-step-ic ob-i-done"><Check /></span>;
  if (state === 'error')   return <span className="ob-step-ic ob-i-error"><Cross /></span>;
  if (state === 'action')  return <span className="ob-step-ic ob-i-action" />;
  return <span className="ob-step-ic ob-i-pending" />;
}

const BTN = { primary: 'ob-btn-primary', secondary: 'ob-btn-secondary' };

/**
 * Auto-runner onboarding modal.
 * steps: [{ label, sub?, state: 'pending'|'running'|'done'|'error'|'action', time?, actionLabel? }]
 */
export function Onboarding({
  title = 'Setting up Cathode Terminal',
  subtitle = 'Installing the environment your agents run in — sit back.',
  steps = [],
  primaryLabel = 'Cancel',
  primaryVariant = 'primary',
  onPrimary,
  showDetails = false,
  detailLog = '',
}) {
  const total = steps.length;
  const done  = steps.filter(s => s.state === 'done').length;
  const active = steps.find(s => s.state === 'running' || s.state === 'action');
  const activeLabel = active ? active.label : (done === total && total ? 'All set — you’re ready to go' : 'Ready to set up');
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="ob-panel">
      <div className="ob-head">
        <div className="ob-title">{title}</div>
        <div className="ob-subtitle">{subtitle}</div>
      </div>

      <div className="ob-progress-head">
        <div className="ob-progress-row">
          <span className="ob-progress-label">{activeLabel}</span>
          <span className="ob-progress-count">{done} of {total} steps</span>
        </div>
        <div className="ob-progress-track"><div className="ob-progress-fill" style={{ width: pct + '%' }} /></div>
      </div>

      <div className="ob-list">
        {steps.map((s, i) => (
          <div key={i} className={'ob-step ob-' + s.state}>
            <StepIcon state={s.state} />
            <div className="ob-step-label">
              {s.label}
              {s.sub && <div className="ob-step-sub">{s.sub}</div>}
            </div>
            {s.state === 'action' && s.actionLabel
              ? <button className="ob-btn ob-btn-sm ob-btn-primary">{s.actionLabel}</button>
              : s.time && <span className="ob-step-time">{s.time}</span>}
          </div>
        ))}
      </div>

      {showDetails && <pre className="ob-log">{detailLog}</pre>}

      <div className="ob-footer">
        <button className="ob-details">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={showDetails ? '3,4.5 6,7.5 9,4.5' : '4.5,3 7.5,6 4.5,9'} />
          </svg>
          {showDetails ? 'Hide details' : 'Show details'}
        </button>
        <button className={'ob-btn ob-btn-md ' + (BTN[primaryVariant] || BTN.primary)} onClick={onPrimary}>{primaryLabel}</button>
      </div>
    </div>
  );
}
