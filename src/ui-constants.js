// ── Page-overlay z-index registry ─────────────────────────────────
// Everything Cathode injects into BROWSED pages stacks near the int32 max so
// it sits above any site content. The relative order is a contract:
//
//   BACKDROP    < SELECTION < ROW_HIGHLIGHT < HOVER_HIGHLIGHT < OVERLAY
//   (dimmer)      (drawn      (popup row →     (element hover    (capture
//                  outline)    page outline)    box + label)      layer/popup)
//
// Use these constants when interpolating z-indexes into injected scripts —
// hardcoded literals are how the ladder drifted out of order before.
const Z = {
  BACKDROP:        2147483640,  // popup dimmer behind inline auth popups
  SELECTION:       2147483643,  // persisted lasso/box outline under the popup
  ROW_HIGHLIGHT:   2147483645,  // element highlight driven from popup rows
  HOVER_HIGHLIGHT: 2147483646,  // live hover box + tag label while picking
  OVERLAY:         2147483647,  // capture overlay & the popup itself (top)
};

module.exports = { Z };
