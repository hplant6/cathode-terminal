import React from 'react';
import './Onboarding.css';

/* The 7-bar "domino" loader — the same working/ready animation from the chat status bar. */
export function Domino({ running = true }) {
  return (
    <ul className={'ob-domino' + (running ? ' running' : '')} role="presentation">
      {Array.from({ length: 7 }).map((_, i) => <li key={i} />)}
    </ul>
  );
}

const Check = () => (
  <svg viewBox="0 0 12 12" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,6.5 5,9 10,3" />
  </svg>
);
const Cross = () => (
  <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M3 3l6 6M9 3l-6 6" />
  </svg>
);

function StepIcon({ state }) {
  if (state === 'running') return <span className="ob-step-ic ob-running"><Domino running /></span>;
  if (state === 'done')    return <span className="ob-step-ic ob-done"><Check /></span>;
  if (state === 'error')   return <span className="ob-step-ic ob-error"><Cross /></span>;
  if (state === 'action')  return <span className="ob-step-ic ob-action">!</span>;
  return <span className="ob-step-ic ob-pending" />;
}

/**
 * Auto-runner onboarding modal.
 * steps: [{ label, sub?, state: 'pending'|'running'|'done'|'error'|'action', time?, actionLabel? }]
 */
export function Onboarding({
  title = 'Setting up Cathode Terminal',
  subtitle = 'Installing the environment your agents run in — sit back.',
  steps = [],
  primaryLabel = 'Cancel',
  primaryGhost = false,
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
          <span className="ob-progress-label">
            {active && active.state === 'running' && <Domino running />}
            {activeLabel}
          </span>
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
              ? <button className="ob-step-action">{s.actionLabel}</button>
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
        <button className={'ob-primary' + (primaryGhost ? ' ghost' : '')} onClick={onPrimary}>{primaryLabel}</button>
      </div>
    </div>
  );
}
