// Single source of truth for the browser/page tool metadata that was previously
// duplicated across: main.js TOOL_KEYS, renderer.js TOOL_BTN, the browser
// context-menu registration, and the onboarding hotkeys list. Behaviour (click
// handlers, IPC, cursors) still lives in renderer.js — this is metadata only.
//
//   key    Alt-<key> shortcut + identity
//   id     toolbar button element id
//   label  short name (toolbar title / context menu)
//   group  'project' → lives in the collapsible #project-tools group
//   menu   true → appears in the browser-view context menu
//   desc   present → listed in the onboarding "Tools" hotkeys section
const TOOLS = [
  { key: 'b', id: 'btn-pick-box',        label: 'Box select',     group: 'project', menu: true,  desc: 'Draw a box to select page elements and send them to chat' },
  { key: 'l', id: 'btn-pick-lasso',      label: 'Lasso select',   group: 'project', menu: true,  desc: 'Freehand-select page elements' },
  { key: 'r', id: 'btn-pick-resize',     label: 'Resize',         group: 'project', menu: true,  desc: 'Resize an element directly on the page' },
  { key: 's', id: 'btn-pick-component',  label: 'Pick component', group: 'project', menu: false },
  { key: 'e', id: 'btn-pick-aidev',      label: 'Extract',        menu: true },
  { key: 'c', id: 'btn-pick-eyedropper', label: 'Eyedropper',     menu: true,  desc: 'Sample any color with a magnifier loupe, then edit it live or send it to chat' },
  { key: 'a', id: 'btn-pick-a11y',       label: 'Accessibility',  menu: true,  desc: 'Scan the page for WCAG contrast failures and a11y issues, then send them to chat to fix' },
  { key: 'i', id: 'btn-screenshot',      label: 'Screenshot',     menu: true,  desc: 'Capture a region of the page for the agent' },
  { key: 'm', id: 'btn-draw',            label: 'Draw',           menu: true,  desc: 'Annotate the page with a marker, then hand it over' },
];

const accelOf = (t) => 'Alt+' + t.key.toUpperCase();

module.exports = { TOOLS, accelOf };
