import React, { useState } from 'react';
import './Slider.css';

// A range slider on the Cathode design tokens — ProgressBar's filled track with an
// accent thumb (Switch's knob). Uncontrolled by default; pass value + onChange to control.
export function Slider({
  min = 0, max = 100, step = 1, defaultValue, value,
  label, showValue = true, suffix = '', disabled = false, width = '280px', onChange,
}) {
  const isControlled = value != null;
  const [internal, setInternal] = useState(defaultValue != null ? defaultValue : min);
  const val = isControlled ? value : internal;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  const handle = (e) => {
    const v = Number(e.target.value);
    if (!isControlled) setInternal(v);
    onChange && onChange(v);
  };
  return (
    <div className="ds-slider-wrap" style={{ width }}>
      {(label || showValue) && (
        <div className="ds-slider-head">
          {label && <span className="ds-slider-label">{label}</span>}
          {showValue && <span className="ds-slider-value">{val}{suffix}</span>}
        </div>
      )}
      <input
        className="ds-slider" type="range"
        min={min} max={max} step={step} value={val} disabled={disabled}
        onChange={handle}
        style={{ '--_pct': pct + '%' }}
      />
    </div>
  );
}
