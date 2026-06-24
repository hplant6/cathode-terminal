const { ipcRenderer } = require('electron');
const { TOOLS: PAGE_TOOLS, accelOf } = require('./tools');
const { Terminal }    = require('@xterm/xterm');
const { FitAddon }    = require('@xterm/addon-fit');
const { gsap }        = require('gsap');
// Color picker. Vendored locally and required directly — loading the UMD build
// via a <script>/CDN in this nodeIntegration renderer attaches to module.exports
// (not window.iro), so the pickers never built. Expose it as window.iro for the
// existing picker code.
try { window.iro = require('@jaames/iro'); } catch (_) {}

// Canvas renderer: xterm 5's default DOM renderer mutates dozens of row
// elements per frame during heavy output. Canvas keeps that off the DOM
// entirely. Optional — falls back to the DOM renderer if it can't load.
let CanvasAddon = null;
try { ({ CanvasAddon } = require('@xterm/addon-canvas')); } catch (_) {}
function attachCanvasRenderer(term) {
  if (!CanvasAddon) return;
  try { term.loadAddon(new CanvasAddon()); } catch (_) {}
}
const { trashIcon, eyeIcon, chevronRightIcon } = require('./icons');

// HTML-escape for any text interpolated into innerHTML templates (escapes
// quotes too, so it is safe in attribute values). The ONLY escaping helper —
// don't add per-module copies.
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── localStorage keys ─────────────────────────────────────────────
// Single registry — get/set sites reference LS.* so key strings can't drift.
const LS = {
  theme:        'cathode-theme',
  apiKey:       'cathode-api-key',
  apiKeys:      'cathode-api-keys',
  profiles:     'cathode-profiles',
  auditTypes:   'cathode-audit-types',
  savedPrompts: 'cathode-saved-prompts',
  tabs:         'cathode-tabs',
  storybook:    'cathode-storybook',
  usageMini:    'cathode-usage-mini',
  onboarded:    'cathode-onboarded',
  projectDir:   'cathode-project-dir',
  devices:      'cathode-devices',        // custom emulation devices
  deviceActive: 'cathode-device-active',  // selected device name (persisted)
  sysperf:      'cathode-sysperf',         // system performance graph on/off
  sysperfView:  'cathode-sysperf-view',    // perf graph view: bars | procs
};

// ── Theme init ────────────────────────────────────────────────────
document.body.dataset.theme = localStorage.getItem(LS.theme) || 'minimal';

const TERMINAL_THEMES = {
  minimal: {
    background: '#131313', foreground: '#cccccc', cursor: '#4a9eff',
    selectionBackground: 'rgba(74,158,255,0.3)',
    black: '#1a1a1a',   brightBlack:   '#555555',
    red: '#f44747',     brightRed:     '#f44747',
    green: '#6a9955',   brightGreen:   '#b5cea8',
    yellow: '#dcdcaa',  brightYellow:  '#dcdcaa',
    blue: '#569cd6',    brightBlue:    '#9cdcfe',
    magenta: '#c586c0', brightMagenta: '#c586c0',
    cyan: '#4ec9b0',    brightCyan:    '#4ec9b0',
    white: '#d4d4d4',   brightWhite:   '#ffffff',
  },
  winamp: {
    background: '#0a0a16', foreground: '#b4ff30', cursor: '#d4aa00',
    selectionBackground: 'rgba(212,170,0,0.3)',
    black: '#07070f',   brightBlack:   '#3a3a5a',
    red: '#ff4444',     brightRed:     '#ff6666',
    green: '#b4ff30',   brightGreen:   '#d4ff80',
    yellow: '#d4aa00',  brightYellow:  '#ffd700',
    blue: '#5555aa',    brightBlue:    '#8888cc',
    magenta: '#cc55cc', brightMagenta: '#ee88ee',
    cyan: '#00ff41',    brightCyan:    '#44ff88',
    white: '#b4ff30',   brightWhite:   '#d4ff80',
  },
};

function applyTheme(name) {
  document.body.dataset.theme = name;
  localStorage.setItem(LS.theme, name);
  const termTheme = TERMINAL_THEMES[name] || TERMINAL_THEMES.minimal;
  TERM_OPTS.theme = termTheme;
  for (const s of sessions.values()) {
    if (s.type !== 'acp' && s.term) s.term.options.theme = termTheme;
  }
}

// ── Pin icons ─────────────────────────────────────────────────────

const TERM_OPTS = {
  cursorBlink: true,
  disableStdin: true,
  fontSize: 14,
  fontFamily: "'Space Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  fontWeight: '400',
  theme: TERMINAL_THEMES[localStorage.getItem(LS.theme)] || TERMINAL_THEMES.minimal,
  scrollback: 5000,
  allowProposedApi: true,
};

const PTY_SEND_DELAY  = 80;  // ms between paste() and sending Enter — gives PTY time to buffer
const MSG_HISTORY_MAX = 500;
const PANEL_ANIM_MS   = 220; // left-panel collapse/expand animation (matches CSS transition)
const PTY_MODEL_SWITCH_SETTLE_MS = 1300; // PTY has no "ready" signal — confirm model switch after this

// ── PTY Sessions ──────────────────────────────────────────────────
const ptySessionsEl = document.getElementById('pty-sessions');
const ptyTabsEl     = document.getElementById('pty-tabs-container');
// chat log / status removed
const sessions      = new Map(); // id → { name, term, fitAddon, el, ro }
let activeId        = null;
let nextId          = 1;

function getDefaultProfile() {
  return sessionProfiles[0] || { name: 'Claude Code', command: 'claude' };
}

// Agents that speak ACP (and thus get the chat front-end). Aider (a REPL) and
// LLM (one-shot) have no agent protocol — they stay terminal-only.
const ACP_AGENT_KEYS = new Set(['claude', 'gemini', 'codex']);
function acpAgentFor(command) {
  const base = (command || '').trim().split(/\s+/)[0].replace(/.*\//, '');
  return ACP_AGENT_KEYS.has(base) ? base : null;
}
// The agent key for any session (used for per-agent memory file, etc.)
function sessionAgent(s) {
  if (!s) return 'claude';
  if (s.type === 'acp') return s.agent || 'claude';
  return (s.command || '').trim().split(/\s+/)[0].replace(/.*\//, '') || 'claude';
}

function createSession(name, command, acp) {
  const profile = getDefaultProfile();
  const cmd     = command != null ? command : profile.command;
  const wantAcp = acp != null ? (acp === true) : (command == null && profile.acp === true);
  const agent   = acpAgentFor(cmd);
  const isAcp   = wantAcp && !!agent;   // only ACP-capable agents get chat
  const id      = nextId++;
  const sName   = name || profile.name;

  if (isAcp) {
    createAcpSession(id, sName, agent, cmd);
    return id;
  }

  const el = document.createElement('div');
  el.className = 'pty-session';
  ptySessionsEl.appendChild(el);

  const termEl = document.createElement('div');
  termEl.className = 'pty-term-wrap';
  el.appendChild(termEl);

  const term     = new Terminal(TERM_OPTS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(termEl);
  attachCanvasRenderer(term);
  term.onData(data => ipcRenderer.send('pty-input', { id, data }));

  const ro = new ResizeObserver(() => {
    fitAddon.fit();
    ipcRenderer.send('pty-resize', { id, cols: term.cols, rows: term.rows });
  });
  ro.observe(termEl);

  ipcRenderer.send('pty-spawn', { id, command: cmd });
  sessions.set(id, {
    name: sName, command: cmd, term, fitAddon, el, termEl, ro,
    claudeLines: [], seenBulletTexts: new Set(), trackedLines: new Set(),
    chatTurnLine: Number.MAX_SAFE_INTEGER, rawLineBuffer: '', rawBulletFlag: false,
    chatMsgs: [], chatAiEl: null, chatDebounce: null, msgSent: false, headerShown: false,
  });
  switchSession(id);
  return id;
}


function createAcpSession(id, name, agent = 'claude', command = 'claude') {
  const el = document.createElement('div');
  el.className = 'pty-session';
  ptySessionsEl.appendChild(el);

  const chatEl = document.createElement('div');
  chatEl.className = 'acp-chat';
  el.appendChild(chatEl);

  const msgsEl = document.createElement('div');
  msgsEl.className = 'acp-messages';
  chatEl.appendChild(msgsEl);
  msgsEl.addEventListener('scroll', () => updateMsgsFade(msgsEl), { passive: true });

  // Terminal view — real xterm PTY (lazy-spawned on first switch)
  const termEl = document.createElement('div');
  termEl.className = 'pty-term-wrap';
  termEl.style.cssText = 'display:none;flex:1;min-height:0;';
  chatEl.appendChild(termEl);

  const acpTerm = new Terminal({ ...TERM_OPTS, disableStdin: false });
  const acpFit  = new FitAddon();
  acpTerm.loadAddon(acpFit);
  acpTerm.open(termEl);
  attachCanvasRenderer(acpTerm);
  acpTerm.onData(data => ipcRenderer.send('pty-input', { id, data }));

  const acpRo = new ResizeObserver(() => {
    if (termEl.style.display !== 'none') {
      acpFit.fit();
      ipcRenderer.send('pty-resize', { id, cols: acpTerm.cols, rows: acpTerm.rows });
    }
  });
  acpRo.observe(termEl);

  const statusEl = document.createElement('div');
  statusEl.className = 'acp-status';
  const specEl = document.createElement('ul');   // domino loader (animates while working)
  specEl.className = 'acp-status-spec';
  specEl.setAttribute('role', 'presentation');
  specEl.innerHTML = '<li></li><li></li><li></li><li></li><li></li><li></li><li></li>';
  const statusTextEl = document.createElement('span');
  statusTextEl.className = 'acp-status-text';
  statusTextEl.textContent = 'Connecting…';
  // Shown (in place of the loader/status) on hover while the agent is working;
  // clicking anywhere on the bar then stops it. See .acp-status.working in styles.css.
  const stopEl = document.createElement('span');
  stopEl.className = 'acp-status-stop';
  stopEl.textContent = 'Stop Agent';

  statusEl.appendChild(specEl);
  statusEl.appendChild(statusTextEl);
  statusEl.appendChild(stopEl);
  statusEl.appendChild(createNotifToggle());
  statusEl.addEventListener('click', () => interruptActiveSession());
  chatEl.appendChild(statusEl);
  const eq = makeStatusAnim(specEl);

  sessions.set(id, {
    name, type: 'acp', agent, command, el, chatEl, msgsEl, specEl, eq, statusEl, statusTextEl,
    termEl, term: acpTerm, fitAddon: acpFit, ro: acpRo, _ptySpawned: false,
    viewMode: 'chat',
    toolCards: new Map(),
    streamEl: null, streamTextEl: null, streamMsgId: null,
  });
  ipcRenderer.send('acp-spawn', { id, agent });
  switchSession(id);
}

function closeSession(id) {
  if (sessions.size <= 1) return;
  const s = sessions.get(id);
  if (!s) return;
  if (activeId === id) {
    const ids = [...sessions.keys()];
    const idx = ids.indexOf(id);
    switchSession(ids[idx + 1] ?? ids[idx - 1]);
  }
  if (s.type === 'acp') {
    ipcRenderer.send('acp-kill', { id });
    if (s._ptySpawned) ipcRenderer.send('pty-kill', { id });
    s.ro.disconnect();
    s.term.dispose();
  } else {
    s.ro.disconnect();
    s.term.dispose();
    ipcRenderer.send('pty-kill', { id });
  }
  s.el.remove();
  sessions.delete(id);
  renderPtyTabs();
}

const svtEl    = document.getElementById('session-view-toggle');
const svtThumb = document.getElementById('svt-thumb');

function updateSvtThumb() {
  const active = svtEl.querySelector('.svt-tab.active');
  if (!active) return;
  svtThumb.style.left  = active.offsetLeft + 'px';
  svtThumb.style.width = active.offsetWidth + 'px';
}

function switchAcpView(id, view) {
  const s = acpSession(id);
  if (!s) return;
  s.viewMode = view;
  s.msgsEl.style.display  = view === 'chat' ? '' : 'none';
  s.termEl.style.display  = view === 'term' ? '' : 'none';
  if (view === 'term') {
    if (!s._ptySpawned) {
      s._ptySpawned = true;
      ipcRenderer.send('pty-spawn', { id, command: s.command || 'claude' });
    }
    refitSession(id, 50);
  }
  svtEl.querySelectorAll('.svt-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  updateSvtThumb();
}

svtEl.querySelectorAll('.svt-tab').forEach(btn => {
  btn.addEventListener('click', () => switchAcpView(activeId, btn.dataset.view));
});

function syncSvt(s) {
  if (!s) { svtEl.style.display = 'none'; return; }
  svtEl.style.display = '';
  const isAcp = s.type === 'acp';
  svtEl.querySelectorAll('.svt-tab').forEach(b => {
    const isChat = b.dataset.view === 'chat';
    b.style.display = (!isAcp && isChat) ? 'none' : '';
    b.classList.toggle('active', isAcp ? b.dataset.view === s.viewMode : b.dataset.view === 'term');
  });
  requestAnimationFrame(updateSvtThumb);
}

// ── Model selector ────────────────────────────────────────────────
const modelWrap  = document.getElementById('model-wrap');
const btnModel   = document.getElementById('btn-model');
const modelLabel = document.getElementById('btn-model-label');
const modelMenu  = document.getElementById('model-menu');

function currentModelLabel(s, key) {
  const cat = MODEL_CATALOG[key];
  if (!cat) return 'Model';
  const sel = cat.models.find(m => m.id === (s.model || ''));
  return sel ? sel.label : (cat.models[0] ? cat.models[0].label : 'Model');
}

function renderModelSelector() {
  const s = sessions.get(activeId);
  const key = sessionToolKey(s);
  if (!s || !key) { modelWrap.style.display = 'none'; return; }
  modelWrap.style.display = '';
  if (s.model === undefined) s.model = MODEL_CATALOG[key].models[0]?.id ?? '';
  const lbl = currentModelLabel(s, key);
  modelLabel.textContent = lbl === 'Model' ? 'Model' : 'Model: ' + lbl;

  modelMenu.innerHTML = '';
  MODEL_CATALOG[key].models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === (s.model || '') ? ' selected' : '');
    item.innerHTML =
      `<svg class="model-check" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 5,9 10,3"></polyline></svg>` +
      `<span class="model-item-label"></span>`;
    item.querySelector('.model-item-label').textContent = m.label;
    item.addEventListener('click', () => {
      modelMenu.classList.remove('open');
      btnModel.classList.remove('active');
      if (m.id === (s.model || '')) return;
      selectModel(m.id);
    });
    modelMenu.appendChild(item);
  });
}

// ── Toasts ────────────────────────────────────────────────────────
const toastStack = document.getElementById('toast-stack');
function showToast(text, { spinner = false, duration = 0 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (spinner) {
    const sp = document.createElement('div');
    sp.className = 'toast-spinner';
    el.appendChild(sp);
  }
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  toastStack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = null;
  function dismiss() {
    if (!el.isConnected) return;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
    if (timer) { clearTimeout(timer); timer = null; }
  }
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return { dismiss, el };
}

function selectModel(modelId) {
  const s = sessions.get(activeId);
  const key = sessionToolKey(s);
  if (!s || !key) return;
  s.model = modelId;
  const label = (MODEL_CATALOG[key].models.find(m => m.id === modelId) || {}).label || modelId || 'Default';

  if (s._modelToast) s._modelToast.dismiss();
  s._modelToast = showToast(`Switching to ${label}…`, { spinner: true });
  s._pendingModelLabel = label;

  if (s.type === 'acp') {
    // Restart the Claude ACP adapter with the chosen model.
    // The toast is dismissed in the acp-ready handler once it reconnects.
    acpSetStatus(s, 'connecting');
    s.statusTextEl.textContent = 'Switching model…';
    ipcRenderer.send('acp-kill', { id: activeId });
    ipcRenderer.send('acp-spawn', { id: activeId, model: modelId, agent: s.agent });
  } else {
    s.term.clear();
    ipcRenderer.send('pty-restart', { id: activeId, command: commandWithModel(s.command, key, modelId) });
    // PTY has no clean "ready" signal — confirm shortly after relaunch.
    setTimeout(() => finishModelSwitch(s), PTY_MODEL_SWITCH_SETTLE_MS);
  }
  renderModelSelector();
}

// Dismiss the "switching…" toast and flash a brief confirmation
function finishModelSwitch(s) {
  if (!s || !s._modelToast) return;
  s._modelToast.dismiss();
  s._modelToast = null;
  showToast(`Model: ${s._pendingModelLabel || ''}`.trim(), { duration: 1800 });
  s._pendingModelLabel = null;
}

// ── Usage panel ───────────────────────────────────────────────────
const usagePanel   = document.getElementById('usage-panel');
const usageBody    = document.getElementById('usage-body');
const usageModelEl = document.getElementById('usage-model');

function fmtCost(usd) {
  if (!(usd > 0)) return '';
  if (usd < 0.01) return '<$0.01';
  return '$' + usd.toFixed(2);
}
const btnUsage     = document.getElementById('btn-usage');
const usageViewFull = document.getElementById('usage-view-full');
const usageViewMini = document.getElementById('usage-view-mini');
let usageOpen = false;
let usageMini = localStorage.getItem(LS.usageMini) === '1';
let _lastUsage = null;

function fmtTokens(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const opts = sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return 'Resets ' + d.toLocaleString(undefined, opts);
}

// LED-segmented bar — warm gradient by position; brightness builds toward the
// leading tip, with the glow concentrated there and fading back (matches the gauge).
function usageSegments(pct, n) {
  const GLOW = 11, TRAIL = 0.55;        // glow spans the last ~11 (dense) segments at the tip
  let litCount = 0;
  for (let i = 0; i < n; i++) if ((i / (n - 1)) * 100 <= pct) litCount++;
  const tip = litCount - 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    if (i > tip) { out += '<span class="ub-seg"></span>'; continue; }
    const [r, g, b] = graphRgbAt(i / (n - 1));
    const lp = tip > 0 ? i / tip : 1;
    const bf = TRAIL + (1 - TRAIL) * lp;
    const cr = Math.round(r * bf), cg = Math.round(g * bf), cb = Math.round(b * bf);
    const d = tip - i;
    let glow = '';
    if (d < GLOW) {
      const t = 1 - d / GLOW;
      glow = `;box-shadow:0 0 ${(1.5 + 4 * t).toFixed(1)}px rgba(${r},${g},${b},${(0.9 * t).toFixed(2)})`;
    }
    out += `<span class="ub-seg on" style="background:rgb(${cr},${cg},${cb})${glow}"></span>`;
  }
  return out;
}
function usageBarRow(label, pct, sub) {
  pct = Math.max(0, Math.min(100, pct || 0));
  // ~2px segment + 2px gap → one cell every 4px of the available width
  const w = usageBody.clientWidth || 600;
  const n = Math.max(24, Math.round(w / 4));
  return `
    <div class="usage-row">
      <div class="usage-row-head">
        <span class="usage-row-label">${label}</span>
        <span class="usage-row-value">${pct.toFixed(0)}% used</span>
      </div>
      <div class="usage-bar">${usageSegments(pct, n)}</div>
      ${sub ? `<div class="usage-sub">${sub}</div>` : ''}
    </div>`;
}

// Semicircle gauge — dense radial ticks in the warm gradient. Brightness builds
// toward the leading tip (dim trail → bright head), and the glow is concentrated
// on the last few ticks at the tip, fading back. Inspired by a backlit knob meter.
const G_GLOW  = 7;     // ticks the tip glow fades over
const G_TRAIL = 0.55;  // brightness at the start of the lit arc (1 = full at the tip)
function gaugeSvg(pct) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const N = 34, cx = 40, cy = 44, rIn = 25, rOut = 34;
  let litCount = 0;
  for (let i = 0; i < N; i++) if ((i / (N - 1)) * 100 <= pct) litCount++;
  const tip = litCount - 1;            // index of the leading (brightest) tick

  let ticks = '';
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const ang = Math.PI - frac * Math.PI;          // 180°→0° across the top
    const c = Math.cos(ang), s = Math.sin(ang);
    const x1 = (cx + rIn * c).toFixed(2), y1 = (cy - rIn * s).toFixed(2);
    const x2 = (cx + rOut * c).toFixed(2), y2 = (cy - rOut * s).toFixed(2);
    if (i > tip) { ticks += `<line class="g-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; continue; }
    const [r, g, b] = graphRgbAt(frac);
    const lp = tip > 0 ? i / tip : 1;              // 0 at start → 1 at tip
    const bf = G_TRAIL + (1 - G_TRAIL) * lp;       // brightness builds toward the tip
    const cr = Math.round(r * bf), cg = Math.round(g * bf), cb = Math.round(b * bf);
    const d = tip - i;                             // distance back from the tip
    // stroke set inline (style) so it wins over the .g-tick CSS rule
    let css = `stroke:rgb(${cr},${cg},${cb})`;
    if (d < G_GLOW) {
      const t = 1 - d / G_GLOW;                    // 1 at the tip → 0 a few ticks back
      const wide = (1.5 + 4.5 * t).toFixed(1);
      css += `;filter:drop-shadow(0 0 ${wide}px rgba(${r},${g},${b},${(0.9 * t).toFixed(2)})) drop-shadow(0 0 1.3px rgba(${r},${g},${b},${Math.min(1, t + 0.2).toFixed(2)}))`;
    }
    ticks += `<line class="g-tick on" style="${css}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  return `<svg class="gauge" viewBox="0 0 80 48" preserveAspectRatio="xMidYMid meet">${ticks}<text class="g-pct" x="40" y="43">${Math.round(pct)}%</text></svg>`;
}

function usageMiniItem(labelHtml, pct, sub, color) {
  return `<div class="usage-mini-item">
    <div class="umi-main">
      ${gaugeSvg(pct, color)}
      <div class="umi-text">
        <div class="umi-label">${labelHtml}</div>
        <div class="umi-sub">${sub || ''}</div>
      </div>
    </div>
  </div>`;
}

function renderUsage({ ctx, lim, isClaude }) {
  usageModelEl.textContent = (ctx && ctx.ok && ctx.model) ? ctx.model : '';

  // Build the shared metric list (each: full label, compact label, %, sub-line)
  const metrics = [];
  if (isClaude && ctx && ctx.ok) {
    const pct = ctx.contextWindow ? (ctx.contextTokens / ctx.contextWindow) * 100 : 0;
    metrics.push({
      label: 'Context window', mini: 'Context<br>Window', pct,
      sub: `${fmtTokens(ctx.contextTokens)}/${fmtTokens(ctx.contextWindow)} tokens`,
    });
  }
  if (lim && lim.ok) {
    // No fixed color → gauges use the same threshold coloring as the bars
    // (accent/blue when low, amber, then red as they fill up).
    metrics.push({
      label: 'Current session (5h)', mini: 'Usage limit:<br>This session',
      pct: lim.fiveHour.utilization, sub: fmtReset(lim.fiveHour.resetsAt),
    });
    if (lim.sevenDay) metrics.push({
      label: 'Current week (all models)', mini: 'Usage limit:<br>Current week',
      pct: lim.sevenDay.utilization, sub: fmtReset(lim.sevenDay.resetsAt),
    });
  }

  if (!metrics.length) {
    const authIssue = lim && lim.reason === 'auth';
    usageBody.innerHTML = `<div class="usage-empty"></div>`;
    usageBody.firstChild.textContent = authIssue
      ? 'Sign in to Claude Code to see usage limits.'
      : (isClaude ? 'No usage data yet for this session.' : 'Usage limits require a Claude sign-in.');
    return;
  }

  const cost = (ctx && ctx.ok) ? fmtCost(ctx.costUsd) : '';
  const costRow = cost
    ? `<div class="usage-cost-row"><span class="usage-cost-label">Session cost</span><span class="usage-cost-val">${cost}</span></div>`
    : '';

  usageBody.innerHTML = (usageMini
    ? `<div class="usage-mini">${metrics.map(m => usageMiniItem(m.mini, m.pct, m.sub, m.color)).join('')}</div>`
    : metrics.map(m => usageBarRow(m.label, m.pct, m.sub)).join('')) + costRow;
}

async function refreshUsage() {
  if (!usageOpen) return;
  const s = sessions.get(activeId);
  const isClaude = !!(s && s.type === 'acp');
  try {
    const [ctx, lim] = await Promise.all([
      isClaude ? ipcRenderer.invoke('get-usage', { cwd: s.cwd || '' }) : Promise.resolve(null),
      ipcRenderer.invoke('get-rate-limits'),
    ]);
    _lastUsage = { ctx, lim, isClaude };
    renderUsage(_lastUsage);
  } catch (_) { /* a failed usage fetch must not break the panel or reject unhandled */ }
}

function setUsageView(mini) {
  usageMini = mini;
  localStorage.setItem(LS.usageMini, mini ? '1' : '0');
  usageViewFull.classList.toggle('active', !mini);
  usageViewMini.classList.toggle('active', mini);
  if (!_lastUsage) { refreshUsage(); return; }

  // Smoothly grow/shrink between the (taller) bar view and the (shorter) dial view.
  const body = usageBody;
  if (body._usageAnimCleanup) body._usageAnimCleanup();   // cancel any in-flight slide

  const startH = body.offsetHeight;
  renderUsage(_lastUsage);                 // swap content (bar ⇄ dial), no refetch
  const endH = body.scrollHeight;
  if (!startH || startH === endH) return;  // nothing to animate

  body.style.overflow = 'hidden';
  body.style.height = startH + 'px';
  void body.offsetHeight;                   // commit the start height before transitioning
  body.style.transition = 'height 0.34s cubic-bezier(0.45,0.05,0.2,1)';
  body.style.height = endH + 'px';

  const done = () => {
    body.style.transition = '';
    body.style.height = '';
    body.style.overflow = '';
    body.removeEventListener('transitionend', onEnd);
    clearTimeout(t);
    body._usageAnimCleanup = null;
  };
  const onEnd = (e) => { if (!e || e.propertyName === 'height') done(); };
  const t = setTimeout(done, 460);          // fallback if transitionend doesn't fire
  body.addEventListener('transitionend', onEnd);
  body._usageAnimCleanup = done;
}
usageViewFull.addEventListener('click', () => setUsageView(false));
usageViewMini.addEventListener('click', () => setUsageView(true));
usageViewFull.classList.toggle('active', !usageMini);
usageViewMini.classList.toggle('active', usageMini);

// Open/close the usage panel with a height grow-in / shrink-out animation.
function setUsageOpen(open) {
  usageOpen = open;
  btnUsage.classList.toggle('active', open);
  document.getElementById('left-panel')?.classList.toggle('usage-open', open);  // sysperf bg → solid shade 7 while usage is open
  const el = usagePanel;
  if (el._growAnim) el._growAnim();   // cancel any in-flight grow/shrink before re-measuring
  if (open) {
    el.style.display = '';
    if (!_lastUsage) { refreshUsage(); return; }   // first load: just show (no measured height yet)
    renderUsage(_lastUsage);                        // populate so the target height is accurate
    refreshUsage();                                 // refresh fresh data in the background
  }
  growPanel(el, open);   // shared height grow/shrink (defined below)
}

btnUsage.addEventListener('click', () => setUsageOpen(!usageOpen));

btnModel.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = modelMenu.classList.toggle('open');
  btnModel.classList.toggle('active', open);
});
document.addEventListener('click', (e) => {
  if (!modelMenu.classList.contains('open')) return;
  if (modelWrap.contains(e.target)) return;
  modelMenu.classList.remove('open');
  btnModel.classList.remove('active');
});

// ── Figma quick actions (composer) ────────────────────────────────
// Shown only when a `figma` MCP server is connected. Selecting an action
// drops a chip into the composer; on send, the chip's instruction is
// prepended so the agent invokes the matching Figma MCP tool.
const FIGMA_ACTIONS = [
  { key: 'build',  group: 'Framelink (paste a Figma URL)', title: 'Build Selected Frame',
    desc: "Turn a Figma frame into production code. Paste the frame's URL — it pulls the layout, styles, and assets and builds it.",
    instruction: "Using the Figma MCP (Framelink figma-developer-mcp), call get_figma_data on the Figma URL provided in this message, then build it as production-ready code that faithfully matches the layout, auto-layout/spacing, colors, typography, and assets. Download any required images/icons with download_images." },
  { key: 'specs',  group: 'Framelink (paste a Figma URL)', title: 'Extract Design Specs',
    desc: "Pull exact specs from a Figma URL: spacing, sizes, colors (hex), and full typography — no eyeballing.",
    instruction: "Using the Figma MCP (Framelink), call get_figma_data on the Figma URL provided and return a structured spec: layout/auto-layout, spacing, element sizes, colors (hex), typography (family, size, weight, line-height, letter-spacing), and border radii." },
  { key: 'icons',  group: 'Framelink (paste a Figma URL)', title: 'Extract Icons',
    desc: "Export the vector / SVG icons inside a Figma frame to files.",
    instruction: "Using the Figma MCP (Framelink), identify the vector/icon nodes within the Figma URL provided and export them as SVG via download_images. List each icon with its name and saved file path." },
  { key: 'images', group: 'Framelink (paste a Figma URL)', title: 'Extract Images',
    desc: "Download the raster images (PNG / JPG) used in a Figma frame.",
    instruction: "Using the Figma MCP (Framelink), download the raster images (PNG/JPG) referenced in the Figma URL provided via download_images. List each with its name, dimensions, and saved file path." },
  { key: 'styles', group: 'Framelink (paste a Figma URL)', title: 'List Styles',
    desc: "List every color and text style used in a Figma file, with their values, and flag off-system ones.",
    instruction: "Using the Figma MCP (Framelink), call get_figma_data on the Figma URL provided and list every color style and text style used (grouped, with their values). Flag any values that look inconsistent or off-system." },
  { key: 'variables', group: 'Dev Mode desktop app (uses your selection)', title: 'Extract Variables',
    desc: "Read the design variables / tokens bound to your current selection in the Figma desktop app.",
    instruction: "Using the Figma Dev Mode MCP server, call get_variable_defs on my current Figma selection and return all bound design variables/tokens (color, spacing, typography, radius) with their names and resolved values." },
  { key: 'create', group: 'Dev Mode desktop app (uses your selection)', title: 'Create Selection',
    desc: "Generate code for whatever you've selected in the Figma desktop app, using your framework and tokens.",
    instruction: "Using the Figma Dev Mode MCP server, generate code for my current Figma selection (get_code). Use the framework I specify (default to this project's framework), our design tokens, and our existing components where available." },
  { key: 'token',  group: 'Dev Mode desktop app (uses your selection)', title: 'Locate Design Token',
    desc: "Map your Figma selection to your real codebase components via Code Connect, instead of generic markup.",
    instruction: "Using the Figma Dev Mode MCP server with Code Connect (get_code_connect_map), map my current Figma selection to our real codebase components and return those components instead of generic markup. If a node has no mapping, note it explicitly." },
];

const FIGMA_GLYPH = `<svg class="figma-glyph" viewBox="0 0 38 57" width="9" height="13" xmlns="http://www.w3.org/2000/svg"><path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 1 1-19 0z"/><path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z"/><path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z"/><path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z"/><path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z"/></svg>`;

const INFO_ICON = `<svg viewBox="0 0 18 18" width="13" height="13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="7.25"/><path d="M6.925,6.619c.388-1.057,1.294-1.492,2.18-1.492,.895,0,1.818,.638,1.818,1.808,0,1.784-1.816,1.468-2.096,3.065"/><path d="M8.791,13.567c-.552,0-1-.449-1-1s.448-1,1-1,1,.449,1,1-.448,1-1,1Z" fill="currentColor" stroke="none"/></svg>`;

const figmaWrap   = document.getElementById('figma-wrap');
const btnFigma    = document.getElementById('btn-figma');
const figmaMenu   = document.getElementById('figma-menu');
const composerChips = document.getElementById('composer-chips');
let figmaChips = [];   // [{key,title,instruction}]
let attachChips = [];  // [{kind:'file'|'folder', path}]

// Chip glyphs for attached files / folders (mirror the toolbar button icons).
const FILE_GLYPH = `<svg class="chip-glyph" viewBox="0 0 18 18" width="11" height="11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.25" xmlns="http://www.w3.org/2000/svg"><path d="M10.985,5.422l-4.773,4.773c-.586,.586-.586,1.536,0,2.121h0c.586,.586,1.536,.586,2.121,0l4.95-4.95c1.172-1.172,1.172-3.071,0-4.243h0c-1.172-1.172-3.071-1.172-4.243,0l-4.95,4.95c-1.757,1.757-1.757,4.607,0,6.364h0c1.757,1.757,4.607,1.757,6.364,0l4.773-4.773"/></svg>`;
const FOLDER_GLYPH = `<svg class="chip-glyph" viewBox="0 0 18 18" width="11" height="11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.25" xmlns="http://www.w3.org/2000/svg"><path d="M1.75,7.75V3.75c0-.552,.448-1,1-1h3.797c.288,0,.563,.125,.753,.342l2.325,2.658"/><rect x="1.75" y="5.75" width="14.5" height="9.5" rx="2" ry="2"/></svg>`;

// Hover tooltip (positioned to the LEFT of the menu so it stays within
// the HTML panel rather than over a native view on the right).
let figmaTipEl = null;
function showFigmaTip(item, text) {
  if (!figmaTipEl) {
    figmaTipEl = document.createElement('div');
    figmaTipEl.className = 'figma-tip';
    document.body.appendChild(figmaTipEl);
  }
  const tip = figmaTipEl;
  tip.textContent = text;
  tip.style.left = '-9999px'; tip.style.top = '-9999px';
  tip.classList.add('show');
  const r = item.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left - tr.width - 10;
  if (left < 8) left = Math.min(r.right + 10, window.innerWidth - tr.width - 8);
  let top = r.top + (r.height - tr.height) / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - tr.height - 8));
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
}
function hideFigmaTip() {
  if (figmaTipEl) figmaTipEl.classList.remove('show');
}

// Custom tooltips — native `title` tooltips can't be styled, so move the text to
// a styled black tip on hover (title → data-tip suppresses the native one).
(function initTooltips() {
  const tip = document.createElement('div');
  tip.id = 'cathode-tip';
  document.body.appendChild(tip);
  let cur = null;

  function place(el) {
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + (r.width - tr.width) / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
    let top = r.top - tr.height - 8;
    if (top < 6) top = r.bottom + 8;            // flip below if no room above
    // Keep the tip clear of the right panel's native browser view (it renders above HTML,
    // so a tip drifting over it gets hidden). Shift left of the view when it would overlap.
    const rp = document.getElementById('right-panel');
    const tb = document.getElementById('tab-bar');
    if (rp) {
      const rpr = rp.getBoundingClientRect();
      const nativeTop = tb ? tb.getBoundingClientRect().bottom : rpr.top;
      if (top + tr.height > nativeTop && left + tr.width > rpr.left - 4) {
        left = Math.max(6, rpr.left - tr.width - 6);
      }
    }
    tip.style.left = Math.round(left) + 'px';
    tip.style.top  = Math.round(top) + 'px';
  }
  function show(el) {
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
    const text = el.dataset.tip;
    if (!text) { cur = null; return; }
    cur = el;
    tip.textContent = text;
    tip.style.left = '-9999px'; tip.style.top = '-9999px';
    tip.classList.add('show');
    place(el);
  }
  function hide() { cur = null; tip.classList.remove('show'); }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest ? e.target.closest('[title], [data-tip]') : null;
    if (!el || el === cur) return;
    show(el);
  });
  document.addEventListener('mouseout', (e) => {
    if (!cur) return;
    if (e.relatedTarget && cur.contains(e.relatedTarget)) return;   // moving within the element
    hide();
  });
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('scroll', hide, true);
})();

(function buildFigmaMenu() {
  const clipHint = document.createElement('div');
  clipHint.className = 'figma-clip-hint';
  clipHint.style.display = 'none';
  figmaMenu.appendChild(clipHint);
  let lastGroup = null;
  FIGMA_ACTIONS.forEach(a => {
    if (a.group !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'figma-group-label';
      g.textContent = a.group;
      figmaMenu.appendChild(g);
      lastGroup = a.group;
    }
    const item = document.createElement('div');
    item.className = 'figma-menu-item';
    const info = document.createElement('span');
    info.className = 'figma-info-btn';
    info.innerHTML = INFO_ICON;
    const label = document.createElement('span');
    label.className = 'figma-item-label';
    label.textContent = a.title;
    item.appendChild(info);
    item.appendChild(label);
    // Tooltip shows immediately when hovering the info icon
    info.addEventListener('mouseenter', () => showFigmaTip(info, a.desc));
    info.addEventListener('mouseleave', hideFigmaTip);
    item.addEventListener('click', () => {
      hideFigmaTip();
      addFigmaChip(a);
      figmaMenu.classList.remove('open');
      btnFigma.classList.remove('active');
    });
    figmaMenu.appendChild(item);
  });
})();

const FIGMA_URL_RE = /https?:\/\/(?:www\.)?figma\.com\/[^\s]+/i;
async function getClipboardFigmaUrl() {
  try {
    const text = await ipcRenderer.invoke('clipboard-read');
    const m = (text || '').match(FIGMA_URL_RE);
    return m ? m[0] : '';
  } catch (_) { return ''; }
}
function truncUrl(u) {
  const s = u.replace(/^https?:\/\/(?:www\.)?figma\.com/i, '') || u;
  return '…' + (s.length > 22 ? s.slice(0, 22) + '…' : s);
}

// Append the glyph + label every chip shares (chip-specific extras stay at the call site).
function fillChip(chip, glyphHtml, text) {
  const glyph = document.createElement('span');
  glyph.innerHTML = glyphHtml;
  chip.appendChild(glyph.firstChild);
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = text;
  chip.appendChild(label);
}

function renderFigmaChips() {
  composerChips.innerHTML = '';
  figmaChips.forEach((c, i) => {
    const incomplete = c.needsUrl && !c.url;
    const chip = document.createElement('span');
    chip.className = 'composer-chip' + (incomplete ? ' incomplete' : '');
    chip.dataset.key = c.key;

    fillChip(chip, FIGMA_GLYPH, c.title);

    if (c.needsUrl) {
      const url = document.createElement('span');
      url.className = 'chip-url' + (c.url ? '' : ' empty');
      url.textContent = c.url ? truncUrl(c.url) : 'Paste Figma URL';
      url.title = c.url || 'Click to paste your Figma URL';
      url.addEventListener('click', (e) => { e.stopPropagation(); editChipUrl(c, chip); });
      chip.appendChild(url);
    }

    const x = document.createElement('button');
    x.className = 'chip-x';
    x.title = 'Remove';
    x.textContent = '✕';
    x.addEventListener('click', () => { figmaChips.splice(i, 1); renderFigmaChips(); });
    chip.appendChild(x);

    composerChips.appendChild(chip);
  });

  attachChips.forEach((c, i) => {
    const chip = document.createElement('span');
    chip.className = 'composer-chip attach-chip';
    chip.title = c.path;

    fillChip(chip, c.kind === 'folder' ? FOLDER_GLYPH : FILE_GLYPH, baseName(c.path));

    const x = document.createElement('button');
    x.className = 'chip-x';
    x.title = 'Remove';
    x.textContent = '✕';
    x.addEventListener('click', () => { attachChips.splice(i, 1); renderFigmaChips(); });
    chip.appendChild(x);

    composerChips.appendChild(chip);
  });

  composerChips.classList.toggle('has-chips', figmaChips.length > 0 || attachChips.length > 0);
}

// Last path segment (handles both \ and / separators), for the chip label.
function baseName(p) {
  const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// Read-only copies of the composer chips (Figma + attach), shown inside the sent
// user message in the chat — same look, minus the remove button.
function buildChatChips(figma, attach) {
  if ((!figma || !figma.length) && (!attach || !attach.length)) return null;
  const wrap = document.createElement('div');
  wrap.className = 'acp-msg-chips';
  (figma || []).forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'composer-chip';
    fillChip(chip, FIGMA_GLYPH, c.title);
    wrap.appendChild(chip);
  });
  (attach || []).forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'composer-chip attach-chip';
    chip.title = c.path;
    fillChip(chip, c.kind === 'folder' ? FOLDER_GLYPH : FILE_GLYPH, baseName(c.path));
    wrap.appendChild(chip);
  });
  return wrap;
}

function addAttachChips(paths, kind) {
  let added = false;
  paths.forEach(p => {
    if (!p || attachChips.some(c => c.path === p)) return;   // skip blanks + dupes
    attachChips.push({ kind, path: p });
    added = true;
  });
  if (added) renderFigmaChips();
  uiTextarea.focus();
}
function clearAttachChips() { attachChips = []; renderFigmaChips(); }

function editChipUrl(c, chip) {
  const urlEl = chip.querySelector('.chip-url');
  if (!urlEl) return;
  const input = document.createElement('input');
  input.className = 'chip-url-input';
  input.value = c.url || '';
  input.placeholder = 'Paste Figma URL';
  urlEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = () => { if (done) return; done = true; c.url = input.value.trim(); renderFigmaChips(); };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); commit(); uiTextarea.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); done = true; renderFigmaChips(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);
}
function focusChipUrl(key) {
  const chip = composerChips.querySelector(`.composer-chip[data-key="${key}"]`);
  const c = figmaChips.find(x => x.key === key);
  if (chip && c) editChipUrl(c, chip);
}

async function addFigmaChip(a) {
  if (figmaChips.some(c => c.key === a.key)) return;   // no dupes
  const needsUrl = a.group.startsWith('Framelink');
  const url = needsUrl ? await getClipboardFigmaUrl() : '';
  figmaChips.push({ key: a.key, title: a.title, instruction: a.instruction, needsUrl, url });
  renderFigmaChips();
  if (needsUrl && !url) focusChipUrl(a.key);   // nothing in clipboard → prompt to paste
  else uiTextarea.focus();
}
function clearFigmaChips() { figmaChips = []; renderFigmaChips(); }

btnFigma.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = figmaMenu.classList.toggle('open');
  btnFigma.classList.toggle('active', open);
  if (!open) { hideFigmaTip(); return; }
  // Surface whether a Figma link is ready in the clipboard
  const hint = figmaMenu.querySelector('.figma-clip-hint');
  const url = await getClipboardFigmaUrl();
  if (hint) {
    hint.textContent = url ? '📋 Figma link in clipboard — Framelink actions will use it' : '';
    hint.style.display = url ? 'block' : 'none';
  }
});
document.addEventListener('click', (e) => {
  if (!figmaMenu.classList.contains('open')) return;
  if (figmaWrap.contains(e.target)) return;
  figmaMenu.classList.remove('open');
  btnFigma.classList.remove('active');
  hideFigmaTip();
});

async function refreshFigmaTool() {
  try {
    const { connected } = await ipcRenderer.invoke('mcp-has-server', { name: 'figma' });
    figmaWrap.style.display = connected ? '' : 'none';
    if (!connected) clearFigmaChips();
  } catch (_) { figmaWrap.style.display = 'none'; }
}
refreshFigmaTool();

// Re-fit a session's terminal to its container and tell the PTY the new size.
// No-ops for ACP sessions showing the chat view (their terminal is hidden).
// `delay` lets layout/animation settle before measuring.
function refitSession(id, delay = 0) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'acp' && s.viewMode !== 'term') return;
  setTimeout(() => {
    s.fitAddon.fit();
    ipcRenderer.send('pty-resize', { id, cols: s.term.cols, rows: s.term.rows });
  }, delay);
}

function switchSession(id) {
  if (activeId !== null) {
    const prev = sessions.get(activeId);
    if (prev) prev.el.classList.remove('active');
  }
  activeId = id;
  const s = sessions.get(id);
  if (!s) return;
  s.el.classList.add('active');
  ipcRenderer.send('set-active-pty', { id });
  refitSession(id);
  syncSvt(s);
  renderModelSelector();
  refreshUsage();
  renderPtyTabs();
}

function renderPtyTabs() {
  ptyTabsEl.innerHTML = '';
  for (const [id, s] of sessions) {
    const tab = document.createElement('div');
    tab.className = 'pty-tab' + (id === activeId ? ' active' : '');

    const nameEl = document.createElement('span');
    nameEl.className = 'pty-tab-name';
    nameEl.textContent = s.name;
    nameEl.title = s.name;
    nameEl.addEventListener('click', e => {
      e.stopPropagation();
      if (id !== activeId) { switchSession(id); return; }
      startRename(nameEl, id);
    });
    tab.appendChild(nameEl);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'pty-tab-settings';
    settingsBtn.title = 'Session settings';
    settingsBtn.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;
    settingsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rect = settingsBtn.getBoundingClientRect();
      ipcRenderer.send('show-tab-settings-menu', { x: Math.round(rect.left), y: Math.round(rect.bottom + 4), agent: sessionAgent(s) });
    });
    tab.appendChild(settingsBtn);

    if (sessions.size > 1) {
      const x = document.createElement('button');
      x.className = 'pty-tab-close';
      x.textContent = '✕';
      x.addEventListener('click', e => { e.stopPropagation(); closeSession(id); });
      tab.appendChild(x);
    }

    tab.addEventListener('click', () => switchSession(id));
    ptyTabsEl.appendChild(tab);
  }
}

function startRename(nameEl, id) {
  const s = sessions.get(id);
  if (!s) return;
  const input = document.createElement('input');
  input.className = 'pty-tab-rename';
  input.value = s.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => { const v = input.value.trim(); if (v) s.name = v; renderPtyTabs(); };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = s.name; input.blur(); }
    e.stopPropagation();
  });
}

const SPINNER_RE  = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
// Strips CSI (ESC [ … letter), OSC (ESC ] … BEL or ST), and 2-char ESC sequences.
// Used only for ● detection; xterm.js gets the original bytes for rendering.
const ANSI_STRIP_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;

ipcRenderer.on('pty-output', (_, { id, data }) => {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'acp') {
    s.term.write(data);
    return;
  }

  /* ── Chat-from-terminal detection (disabled — pivoted to stream-json) ──
  {
    const stripped = data.replace(ANSI_STRIP_RE, '');
    const lines = (s.rawLineBuffer + stripped).split('\n');
    s.rawLineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const segs = line.split('\r');
      let content = '';
      for (let i = segs.length - 1; i >= 0; i--) {
        if (segs[i]) { content = segs[i]; break; }
      }
      const trimmed = content.trimStart();
      if (trimmed.startsWith('●') || trimmed.startsWith('•')) {
        s.rawBulletFlag = true;
        break;
      }
    }
  }
  ── end disabled block ── */

  s.term.write(data, () => {
    /* disabled: if (s.rawBulletFlag) {
      s.rawBulletFlag = false;
      if (scanBufferForBullets(id)) updateChatAi(id);
    } */
    const hasBullet  = data.includes('●') || data.includes('•');
    const hasSpinner = SPINNER_RE.test(data);
  });
});


document.getElementById('btn-restart').addEventListener('click', () => {
  const s = sessions.get(activeId);
  if (!s || s.type === 'acp') return;
  s.term.clear();
  ipcRenderer.send('pty-restart', { id: activeId, command: s.command });
});

// ── Session Profiles ─────────────────────────────────────────────
const PROFILES_KEY = LS.profiles;
const DEFAULT_PROFILES = [
  { id: 'claude', name: 'Claude Code', command: 'claude', acp: true },
];

// `acp: true` → speaks the Agent Client Protocol, so it gets the chat front-end
// by default. Aider (REPL) and LLM (one-shot) are terminal-only.
const AVAILABLE_MODELS = [
  { id: 'codex',  name: 'OpenAI Codex CLI', desc: "OpenAI's AI coding agent for the terminal",       install: 'npm install -g @openai/codex',                                                              command: 'codex',  acp: true  },
  { id: 'gemini', name: 'Gemini CLI',        desc: "Google's AI assistant for the command line",      install: 'npm install -g @google/gemini-cli',                                                         command: 'gemini', acp: true  },
  { id: 'aider',  name: 'Aider',             desc: 'AI pair programming in your terminal',            install: 'curl -fsSL https://aider.chat/install.sh | sh',                                             command: 'aider',  acp: false },
  { id: 'llm',    name: 'LLM CLI',           desc: 'Multi-model CLI tool, supports many providers',   install: 'curl -LsSf https://astral.sh/uv/install.sh | sh && ~/.local/bin/uv tool install llm',       command: 'llm',    acp: false },
];

// ── Per-tool model catalog ────────────────────────────────────────
// `flag` is the CLI flag used to launch the tool with a model (PTY tools).
// Claude (ACP) is special-cased: model is applied via ANTHROPIC_MODEL on respawn.
// `id: ''` means "tool default" (no flag / inherit settings).
const MODEL_CATALOG = {
  claude: { flag: '--model', models: [
    { id: '',       label: 'Default' },
    { id: 'opus',   label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku',  label: 'Haiku' },
  ]},
  codex: { flag: '--model', models: [
    { id: '',            label: 'Default' },
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'gpt-5',       label: 'GPT-5' },
    { id: 'o4-mini',     label: 'o4-mini' },
    { id: 'o3',          label: 'o3' },
  ]},
  gemini: { flag: '-m', models: [
    { id: '',                 label: 'Default' },
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ]},
  aider: { flag: '--model', models: [
    { id: '',         label: 'Default' },
    { id: 'sonnet',   label: 'Claude Sonnet' },
    { id: 'opus',     label: 'Claude Opus' },
    { id: 'gpt-4o',   label: 'GPT-4o' },
    { id: 'gpt-4.1',  label: 'GPT-4.1' },
    { id: 'deepseek', label: 'DeepSeek' },
  ]},
  llm: { flag: '-m', models: [
    { id: '',                  label: 'Default' },
    { id: 'gpt-4o',            label: 'GPT-4o' },
    { id: 'gpt-4o-mini',       label: 'GPT-4o mini' },
    { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro' },
  ]},
};

// Map a session to its tool key in MODEL_CATALOG (or null if no models known)
function sessionToolKey(s) {
  if (!s) return null;
  // ACP model switching is only wired for Claude (ANTHROPIC_MODEL on respawn).
  // Gemini/Codex ACP run at their default model → hide the selector for now.
  if (s.type === 'acp') return s.agent === 'claude' ? 'claude' : null;
  const base = (s.command || '').trim().split(/\s+/)[0].replace(/.*\//, '');
  return MODEL_CATALOG[base] ? base : null;
}

// Build a PTY launch command for a base command + chosen model
function commandWithModel(baseCommand, toolKey, modelId) {
  const cat = MODEL_CATALOG[toolKey];
  if (!cat || !cat.flag || !modelId) return baseCommand;
  return `${baseCommand} ${cat.flag} ${modelId}`;
}

let sessionProfiles = (() => {
  try {
    const s = localStorage.getItem(PROFILES_KEY);
    if (s) {
      let parsed = JSON.parse(s);
      // Base migration: claude defaults to acp:true; others respect their flag.
      parsed = parsed.map(p => p.id === 'claude'
        ? { ...p, acp: p.acp !== false }
        : { ...p, acp: p.acp === true });
      // One-time v2 upgrade: ACP-capable agents (Gemini/Codex) now default to
      // the chat front-end. Terminal stays one click away via the toggle.
      if (!localStorage.getItem('cathode-profiles-acpv2')) {
        parsed = parsed.map(p => {
          const base = (p.command || '').trim().split(/\s+/)[0];
          return (base === 'gemini' || base === 'codex') ? { ...p, acp: true } : p;
        });
        localStorage.setItem('cathode-profiles-acpv2', '1');
        localStorage.setItem(PROFILES_KEY, JSON.stringify(parsed));
      }
      return parsed;
    }
  } catch (_) {}
  return DEFAULT_PROFILES.map(p => ({ ...p }));
})();

function saveProfiles() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(sessionProfiles));
}

// ── Profile dropdown ──────────────────────────────────────────────
const profileMenu   = document.getElementById('profile-menu');
const btnNewPty     = document.getElementById('btn-new-pty');

function renderProfileMenu() {
  profileMenu.innerHTML = '';
  sessionProfiles.forEach(profile => {
    const item = document.createElement('div');
    item.className = 'profile-item';
    item.textContent = profile.name;
    item.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      createSession(profile.name, profile.command, profile.acp);
    });
    profileMenu.appendChild(item);
  });
  const divider = document.createElement('div');
  divider.className = 'audit-divider';
  profileMenu.appendChild(divider);
  const manage = document.createElement('div');
  manage.className = 'profile-item profile-item-manage';
  manage.textContent = 'Manage profiles…';
  manage.addEventListener('click', () => {
    profileMenu.classList.remove('open');
    openProfilesModal();
  });
  profileMenu.appendChild(manage);
}

btnNewPty.addEventListener('click', () => {
  renderProfileMenu();
  profileMenu.classList.toggle('open');
});

document.addEventListener('click', e => {
  if (!profileMenu.classList.contains('open')) return;
  if (!btnNewPty.closest('#new-pty-wrap').contains(e.target)) profileMenu.classList.remove('open');
});

// ── Profiles modal ────────────────────────────────────────────────
const profilesModal    = document.getElementById('profiles-modal');
const profilesList     = document.getElementById('profiles-list');

const DELETE_ICON_SVG = trashIcon(15);
const AP_CHEVRON_SVG  = chevronRightIcon(11);

function addProfileCard(name = '', command = '', startExpanded = false, profileId = '') {
  const card = document.createElement('div');
  card.className = 'ap-card' + (startExpanded ? ' expanded' : '');
  card.dataset.profileId = profileId;   // identity survives deletions/reordering
  card.innerHTML = `
    <div class="ap-card-row">
      <button class="ap-chevron" title="Expand">${AP_CHEVRON_SVG}</button>
      <span class="ap-card-name">${escHtml(name) || '<em>Untitled</em>'}</span>
      <button class="ap-delete" title="Remove">${DELETE_ICON_SVG}</button>
    </div>
    <div class="ap-card-body" style="${startExpanded ? '' : 'display:none'}">
      <span class="ap-field-title">Profile Name</span>
      <input class="ap-label" placeholder="e.g. Claude Code" value="${escHtml(name)}" />
      <span class="ap-field-title">Command</span>
      <input class="ap-label profile-cmd" placeholder="e.g. claude" value="${escHtml(command)}" />
    </div>
  `;
  const row     = card.querySelector('.ap-card-row');
  const body    = card.querySelector('.ap-card-body');
  const nameEl  = card.querySelector('.ap-card-name');
  const nameIn  = card.querySelector('.ap-label');

  function toggle() {
    const open = card.classList.toggle('expanded');
    body.style.display = open ? '' : 'none';
  }

  row.addEventListener('click', e => {
    if (e.target.closest('.ap-delete')) return;
    toggle();
  });

  nameIn.addEventListener('input', () => {
    nameEl.textContent = nameIn.value || '';
    if (!nameIn.value) nameEl.innerHTML = '<em>Untitled</em>';
  });

  card.querySelector('.ap-delete').addEventListener('click', () => card.remove());
  profilesList.appendChild(card);
}

const profilesModalCtl = wireModal(profilesModal, {
  onClose: () => _installListeners.forEach(fn => fn()),   // detach streaming-install listeners
});

function openProfilesModal() {
  profilesList.innerHTML = '';
  sessionProfiles.forEach(p => addProfileCard(p.name, p.command, false, p.id));
  switchProfilesTab('mine');
  profilesModalCtl.open();
}

function switchProfilesTab(tab) {
  document.querySelectorAll('.profiles-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('profiles-tab-mine').style.display    = tab === 'mine'    ? '' : 'none';
  document.getElementById('profiles-tab-install').style.display = tab === 'install' ? '' : 'none';
  document.getElementById('profiles-footer-mine').style.display    = tab === 'mine'    ? '' : 'none';
  document.getElementById('profiles-footer-install').style.display = tab === 'install' ? '' : 'none';
  if (tab === 'install') renderInstallModels();
}

// Active install listeners keyed by installId so we can clean them up
const _installListeners = new Map();

function renderInstallModels() {
  const list = document.getElementById('install-models-list');
  list.innerHTML = '';
  AVAILABLE_MODELS.forEach(model => {
    const alreadyAdded = sessionProfiles.some(p => p.command === model.command);
    const card = document.createElement('div');
    card.className = 'im-card';
    card.innerHTML = `
      <div class="im-header">
        <span class="im-name">${model.name}</span>
        <span class="im-badge checking">Checking…</span>
      </div>
      <span class="im-desc">${model.desc}</span>
      <code class="im-cmd">${model.install}</code>
      <button class="im-btn${alreadyAdded ? ' added' : ''}" disabled>${alreadyAdded ? 'Added ✓' : '…'}</button>
      <pre class="im-progress" style="display:none"></pre>
    `;
    list.appendChild(card);
    const badge      = card.querySelector('.im-badge');
    const btn        = card.querySelector('.im-btn');
    const progressEl = card.querySelector('.im-progress');

    ipcRenderer.invoke('check-model', { command: model.command }).then(installed => {
      badge.textContent = installed ? 'Installed' : 'Not installed';
      badge.className   = `im-badge ${installed ? 'installed' : 'not-installed'}`;
      if (alreadyAdded) return;
      btn.disabled = false;
      if (installed) {
        btn.textContent = 'Add Profile';
        btn.addEventListener('click', () => {
          sessionProfiles.push({ id: `profile-${Date.now()}`, name: model.name, command: model.command, acp: model.acp === true });
          saveProfiles();
          btn.textContent = 'Added ✓';
          btn.classList.add('added');
          btn.disabled = true;
        });
      } else {
        btn.textContent = 'Install';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Installing…';
          badge.textContent = 'Installing…';
          badge.className = 'im-badge checking';
          progressEl.style.display = '';
          progressEl.textContent = `$ ${model.install}\n`;

          const installId = `install-${Date.now()}`;

          const onProgress = (_, { installId: iid, text }) => {
            if (iid !== installId) return;
            progressEl.textContent += text;
            progressEl.scrollTop = progressEl.scrollHeight;
          };
          const onDone = (_, { installId: iid }) => {
            if (iid !== installId) return;
            cleanup();
            badge.textContent = 'Installed';
            badge.className = 'im-badge installed';
            btn.textContent = 'Added ✓';
            btn.classList.add('added');
            progressEl.textContent += '\n✓ Done';
            if (!sessionProfiles.some(p => p.command === model.command)) {
              sessionProfiles.push({ id: `profile-${Date.now()}`, name: model.name, command: model.command, acp: model.acp === true });
              saveProfiles();
            }
          };
          const onError = (_, { installId: iid, code, message }) => {
            if (iid !== installId) return;
            cleanup();
            badge.textContent = 'Failed';
            badge.className = 'im-badge not-installed';
            btn.disabled = false;
            btn.textContent = 'Retry';
            progressEl.textContent += `\n✗ Failed (exit ${code ?? ''} ${message ?? ''})`;
          };

          function cleanup() {
            ipcRenderer.off('profile-install-progress', onProgress);
            ipcRenderer.off('profile-install-done',     onDone);
            ipcRenderer.off('profile-install-error',    onError);
            _installListeners.delete(installId);
          }

          ipcRenderer.on('profile-install-progress', onProgress);
          ipcRenderer.on('profile-install-done',     onDone);
          ipcRenderer.on('profile-install-error',    onError);
          _installListeners.set(installId, cleanup);

          ipcRenderer.send('profile-install', { installId, command: model.install });
        });
      }
    });
  });
}

document.getElementById('profiles-add').addEventListener('click', () => addProfileCard('', '', true));

document.getElementById('profiles-save').addEventListener('click', () => {
  const cards = profilesList.querySelectorAll('.ap-card');
  const updated = [];
  cards.forEach((card, i) => {
    const inputs = card.querySelectorAll('input');
    const name   = inputs[0].value.trim();
    const command = inputs[1].value.trim();
    if (name && command) {
      // Match by stored id, NOT by index — after a deletion, index pairing
      // shifted and could hand another profile Claude's acp flag.
      const existing = sessionProfiles.find(p => p.id === card.dataset.profileId);
      // Keep an existing profile's choice; a new ACP-capable command defaults to chat.
      const acp = existing ? existing.acp === true : (acpAgentFor(command) != null);
      updated.push({ id: existing?.id || `profile-${Date.now()}-${i}`, name, command, acp });
    }
  });
  if (!updated.length) return;
  sessionProfiles = updated;
  saveProfiles();
  profilesModalCtl.close();
});

document.getElementById('btn-manage-profiles')?.addEventListener('click', () => openProfilesModal());

document.getElementById('profiles-cancel').addEventListener('click', () => profilesModalCtl.close());
document.getElementById('profiles-install-done').addEventListener('click', () => profilesModalCtl.close());

document.querySelectorAll('.profiles-tab').forEach(btn => {
  btn.addEventListener('click', () => switchProfilesTab(btn.dataset.tab));
});

// ── Modal overlay — hide native views while any modal is open ────
// Single source of truth. Watches the WHOLE document so ANY modal that uses
// the `.modal-backdrop` + `.open` convention is covered automatically —
// including modals added dynamically. New modals "just work" with no extra
// wiring; they must NOT manually toggle individual views.
(function initModalOverlay() {
  let last = null;
  function sync() {
    const open = !!document.querySelector('.modal-backdrop.open');
    if (open === last) return;          // only signal on actual change
    last = open;
    ipcRenderer.send('modal-overlay', { open });
  }
  // Observe ONLY the modal backdrops' class attributes — the previous
  // whole-document subtree observer ran this callback for every DOM mutation
  // in the app (every chat chunk, every xterm frame). Modals added later are
  // caught by a cheap non-subtree childList watch on <body>; the convention
  // (".modal-backdrop" + ".open", attached under <body>) is unchanged.
  const attrObs = new MutationObserver(sync);
  const watched = new WeakSet();
  function watch(el) {
    if (watched.has(el)) return;
    watched.add(el);
    attrObs.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  document.querySelectorAll('.modal-backdrop').forEach(watch);
  const addObs = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList?.contains('modal-backdrop')) watch(n);
        n.querySelectorAll?.('.modal-backdrop').forEach(watch);
      }
    }
    sync();   // also covers a modal being removed while open
  });
  addObs.observe(document.body, { childList: true });
  sync();
})();

// ── Modal helper ──────────────────────────────────────────────────
// Standard plumbing for `.modal-backdrop` modals: Escape closes, clicking the
// backdrop closes (unless disabled), open/close just toggle `.open`. Native
// views are hidden by the document-level observer above — do NOT send
// browser-view-hide/show or modal-overlay manually from modal code.
function wireModal(modal, { backdropClose = true, onClose } = {}) {
  const close = () => {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    onClose?.();
  };
  if (backdropClose) modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
  return { open: () => modal.classList.add('open'), close };
}

// ── Global custom dropdown ────────────────────────────────────────
// Replaces each native <select>'s visuals with a styleable widget (so the
// OPEN list can be padded/spaced) while keeping the <select> for value/events.
// Programmatic `sel.value = …` stays transparent via a value setter shim.
function enhanceSelect(sel) {
  if (sel._ctEnhanced) return;
  sel._ctEnhanced = true;

  const wrap = document.createElement('div');
  wrap.className = 'ct-select' + (sel.classList.contains('tabs-add-select-field') ? ' tabs-add-select-field' : '');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  const btn = document.createElement('div');
  btn.className = 'ct-select-btn';
  btn.innerHTML = `<span class="ct-select-label"></span><svg class="ct-select-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,4.5 6,8.5 10,4.5"></polyline></svg>`;
  const labelEl = btn.querySelector('.ct-select-label');
  const menu = document.createElement('div');
  menu.className = 'ct-select-menu';
  wrap.appendChild(btn);
  wrap.appendChild(menu);

  function buildMenu() {
    menu.innerHTML = '';
    Array.from(sel.options).forEach(opt => {
      const item = document.createElement('div');
      item.className = 'ct-select-opt' + (opt.value === sel.value ? ' selected' : '') + (opt.value === '' ? ' placeholder' : '');
      item.textContent = opt.textContent;
      item.addEventListener('click', () => {
        if (sel.value !== opt.value) {
          sel.value = opt.value;                         // refresh() via setter shim
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        close();
      });
      menu.appendChild(item);
    });
  }
  function refresh() {
    const opt = sel.options[sel.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : '';
    labelEl.classList.toggle('placeholder', !sel.value);
    menu.querySelectorAll('.ct-select-opt').forEach((it, i) => {
      it.classList.toggle('selected', sel.options[i] && sel.options[i].value === sel.value);
    });
  }
  function close() { wrap.classList.remove('open'); }
  function open()  {
    buildMenu(); refresh();
    wrap.classList.add('open');
    // Position the fixed menu against the button; flip up if it would overflow below
    const r = btn.getBoundingClientRect();
    // Compact variant (e.g. inline property fields): the button is small, so size
    // the menu to its options and right-align it to the button instead of matching width.
    const compact = wrap.classList.contains('pp-ct');
    if (compact) { menu.style.width = 'auto'; menu.style.minWidth = Math.max(r.width, 90) + 'px'; menu.style.maxWidth = '220px'; }
    else { menu.style.minWidth = ''; menu.style.maxWidth = ''; menu.style.width = r.width + 'px'; }
    menu.style.left = '-9999px';
    menu.style.top  = '-9999px';
    const mh = menu.offsetHeight, mw = menu.offsetWidth;
    let left = compact ? (r.right - mw) : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    menu.style.left = left + 'px';
    const below = window.innerHeight - r.bottom - 8;
    menu.style.top = (mh <= below || r.top < mh + 8)
      ? (r.bottom + 4) + 'px'
      : (r.top - 4 - mh) + 'px';
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.contains('open') ? close() : open();
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return desc.get.call(sel); },
    set(v) { desc.set.call(sel, v); refresh(); },
  });

  buildMenu();
  refresh();
}
document.querySelectorAll('select.modal-input').forEach(enhanceSelect);

// ── ACP chat helpers ──────────────────────────────────────────────
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
}

const GRAPH_STOPS = [[0, '#FF5720'], [0.5, '#FFE16B'], [1, '#FCF2C8']];                       // usage graphs
function _specHx(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function _rgbAt(p, stops) {
  p = Math.max(0, Math.min(1, p));
  for (let i = 1; i < stops.length; i++) {
    const [o1, c1] = stops[i - 1], [o2, c2] = stops[i];
    if (p <= o2) {
      const f = (o2 === o1) ? 0 : (p - o1) / (o2 - o1);
      const a = _specHx(c1), b = _specHx(c2);
      return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
    }
  }
  return _specHx(stops[stops.length - 1][1]);
}
function graphRgbAt(p) { return _rgbAt(p, GRAPH_STOPS); }   // usage gauge/bar warm ramp

// Status animation controller for the domino loader.
// start(): run the cascade. stop(): freeze each bar where the cascade left it,
// then release so the CSS transition eases them all up to standing (FLIP).
function makeStatusAnim(el) {
  const bars = () => Array.from(el.querySelectorAll('li'));
  return {
    start() {
      bars().forEach(b => { b.style.transition = ''; b.style.transform = ''; b.style.opacity = ''; });
      el.classList.add('running');
    },
    stop() {
      const list = bars();
      if (!list.length) { el.classList.remove('running'); return; }
      // capture the live (animated) pose of each bar before stopping
      const frozen = list.map(b => { const s = getComputedStyle(b); return [s.transform, s.opacity]; });
      el.classList.remove('running');
      // pin them at that pose with no transition…
      list.forEach((b, i) => { b.style.transition = 'none'; b.style.transform = frozen[i][0]; b.style.opacity = frozen[i][1]; });
      void el.offsetWidth;   // reflow to commit the pinned pose
      // …then release to the CSS rest pose — the transition animates the stand-up
      list.forEach(b => { b.style.transition = ''; b.style.transform = ''; b.style.opacity = ''; });
    },
  };
}

// ── Notification sounds ───────────────────────────────────────────
const ALERT_ON_ICON  = `<svg viewBox="0 0 18 18" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.0498 6.5C13.0498 4.2636 11.2364 2.4502 9 2.4502C6.7636 2.4502 4.9502 4.2636 4.9502 6.5V10.75C4.9502 11.2215 4.82844 11.6642 4.61621 12.0498H13.3838C13.1716 11.6642 13.0498 11.2215 13.0498 10.75V6.5ZM14.4502 10.75C14.4502 11.4684 15.0316 12.0498 15.75 12.0498C16.1366 12.0498 16.4502 12.3634 16.4502 12.75C16.4502 13.0884 16.2098 13.3704 15.8906 13.4355L15.75 13.4502H2.25C1.8634 13.4502 1.5498 13.1366 1.5498 12.75C1.5498 12.3634 1.8634 12.0498 2.25 12.0498C2.9684 12.0498 3.5498 11.4684 3.5498 10.75V6.5C3.5498 3.4904 5.9904 1.0498 9 1.0498C12.0096 1.0498 14.4502 3.4904 14.4502 6.5V10.75Z"/><path d="M9.89452 15.0337C10.0882 14.6992 10.516 14.5852 10.8506 14.7788C11.1851 14.9725 11.2991 15.4003 11.1055 15.7349C10.686 16.4596 9.90081 16.9497 8.99999 16.9497C8.09916 16.9497 7.314 16.4596 6.89452 15.7349C6.70089 15.4003 6.8149 14.9725 7.1494 14.7788C7.48396 14.5852 7.91177 14.6992 8.10546 15.0337C8.28499 15.3439 8.61906 15.5503 8.99999 15.5503C9.38091 15.5503 9.71499 15.3439 9.89452 15.0337Z"/></svg>`;
const ALERT_OFF_ICON = `<svg viewBox="0 0 18 18" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3.5498 10.75V6.5C3.5498 3.4904 5.9904 1.0498 9 1.0498C11.2584 1.0498 13.1946 2.42434 14.0215 4.37891C14.1718 4.73486 14.0053 5.14533 13.6494 5.2959C13.2934 5.4465 12.8831 5.27983 12.7324 4.92383C12.1169 3.46879 10.6762 2.4502 9 2.4502C6.7636 2.4502 4.9502 4.2636 4.9502 6.5V10.75C4.9502 11.2215 4.82844 11.6642 4.61621 12.0498H5.25C5.6366 12.0498 5.9502 12.3634 5.9502 12.75C5.9502 13.1366 5.6366 13.4502 5.25 13.4502H2.25C1.8634 13.4502 1.5498 13.1366 1.5498 12.75C1.5498 12.3634 1.8634 12.0498 2.25 12.0498C2.9684 12.0498 3.5498 11.4684 3.5498 10.75Z"/><path d="M13.0498 10.75V8.4922C13.0498 8.1056 13.3634 7.79201 13.75 7.79201C14.1366 7.79201 14.4502 8.1056 14.4502 8.4922V10.75C14.4502 11.4684 15.0316 12.0498 15.75 12.0498C16.1366 12.0498 16.4502 12.3634 16.4502 12.75C16.4502 13.1366 16.1366 13.4502 15.75 13.4502H9.49219C9.10559 13.4502 8.792 13.1366 8.79199 12.75C8.79199 12.3634 9.10559 12.0498 9.49219 12.0498H13.3838C13.1716 11.6642 13.0498 11.2215 13.0498 10.75Z"/><path d="M9.89453 15.0337C10.0882 14.6992 10.516 14.5852 10.8506 14.7788C11.1851 14.9725 11.2991 15.4003 11.1055 15.7349C10.686 16.4596 9.90083 16.9497 9 16.9497C8.09918 16.9497 7.31402 16.4596 6.89453 15.7349C6.70091 15.4003 6.81491 14.9725 7.14942 14.7788C7.48398 14.5852 7.91179 14.6992 8.10547 15.0337C8.285 15.3439 8.61908 15.5503 9 15.5503C9.38092 15.5503 9.715 15.3439 9.89453 15.0337Z"/><path d="M15.5049 1.50488C15.7782 1.23151 16.2217 1.23151 16.4951 1.50488C16.7685 1.77824 16.7685 2.22174 16.4951 2.49511L2.49511 16.4951C2.22174 16.7685 1.77824 16.7685 1.50488 16.4951C1.23151 16.2217 1.23151 15.7782 1.50488 15.5049L15.5049 1.50488Z"/></svg>`;

// Distinct synthesized cue per event type, gated by a persisted master toggle.
const Notif = (() => {
  let on = localStorage.getItem('cathode-notif') === '1';
  let ctx = null;
  const ac = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
  function blip(freq, start, dur, gain = 0.16, type = 'sine') {
    const c = ac();
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  }
  // Preload + reuse one element per file: a throwaway `new Audio()` can be GC'd
  // mid-play, and re-fetching the file every time is wasteful. Reset + replay.
  const _cache = {};
  function audioFor(src) {
    let a = _cache[src];
    if (!a) { a = _cache[src] = new Audio(src); a.preload = 'auto'; }
    return a;
  }
  function playFile(src, vol = 0.6) {
    const a = audioFor(src);
    a.volume = vol;
    try { a.currentTime = 0; } catch (_) {}
    a.play().catch(err => console.warn('[notif] sound failed:', src, err && err.message));
  }
  // Warm the cache up front so the first alert isn't delayed by a cold fetch.
  ['sounds/error.wav', 'sounds/message.wav'].forEach(src => { try { audioFor(src); } catch (_) {} });
  const sounds = {
    done:    () => { blip(659.25, 0, 0.13); blip(987.77, 0.10, 0.22); },   // synth fallback (not wired)
    message: () => playFile('sounds/message.wav'),                         // KEDR servo-bot data response
    error:   () => playFile('sounds/error.wav'),                          // Slava Pogorelsky error tone
    limit:   () => playFile('sounds/error.wav'),                          // same as error, per request
  };
  function setOn(v) { on = !!v; localStorage.setItem('cathode-notif', on ? '1' : '0'); syncNotifToggles(); }
  return {
    play(type) { if (!on) return; try { (sounds[type] || sounds.done)(); } catch (_) {} },
    isOn: () => on,
    toggle: () => setOn(!on),
  };
})();

function syncNotifToggles() {
  const on = Notif.isOn();
  document.querySelectorAll('.notif-toggle').forEach(b => {
    b.innerHTML = on ? ALERT_ON_ICON : ALERT_OFF_ICON;
    b.classList.toggle('on', on);
    b.title = on ? 'Notification sounds: on' : 'Notification sounds: off';
  });
}

function createNotifToggle() {
  const btn = document.createElement('button');
  btn.className = 'notif-toggle' + (Notif.isOn() ? ' on' : '');
  btn.innerHTML = Notif.isOn() ? ALERT_ON_ICON : ALERT_OFF_ICON;
  btn.title = Notif.isOn() ? 'Notification sounds: on' : 'Notification sounds: off';
  btn.addEventListener('click', (e) => { e.stopPropagation(); Notif.toggle(); });
  return btn;
}

// The session for id, but only if it's a live ACP session (else null).
function acpSession(id) {
  const s = sessions.get(id);
  return s && s.type === 'acp' ? s : null;
}

function acpSetStatus(s, state) {
  const prev = s.status;
  const labels = { ready: 'Ready', thinking: 'Working…', connecting: 'Connecting…', installing: 'Installing adapter…', error: 'Error', closed: 'Session ended' };
  s.status = state;
  s.statusTextEl.textContent = labels[state] || state;
  if (s.statusEl) s.statusEl.classList.toggle('working', state === 'thinking');
  if (s.eq) { if (state === 'thinking') s.eq.start(); else s.eq.stop(); }
  // Alerts: error (task-complete is covered by the per-message sound on finalize)
  if (state === 'error' && prev !== 'error') Notif.play('error');
}

// Coalesced to one scroll per frame — streaming calls this per chunk, and an
// unbatched scrollIntoView forces a full layout pass every call.
// Fade the top/bottom edges only when content is actually scrolled past them — so the
// banner resting at the very top (startup) is never faded.
function updateMsgsFade(el) {
  if (!el) return;
  el.classList.toggle('fade-top', el.scrollTop > 6);
  el.classList.toggle('fade-bot', el.scrollHeight - el.scrollTop - el.clientHeight > 6);
  el._stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;   // near bottom → keep following
}

// Cap the rendered chat at ACP_MAX_MSGS nodes so long sessions stay bounded
// (the full transcript is still in the terminal's 5000-line scrollback). Drops
// the matching toolCards entry too, so a trimmed card isn't pinned in memory.
const ACP_MAX_MSGS = 300;
function acpTrim(s) {
  const msgs = s.msgsEl;
  while (msgs.childElementCount > ACP_MAX_MSGS) {
    const old = msgs.firstElementChild;
    if (!old) break;
    if (old.dataset.toolKey) s.toolCards.delete(old.dataset.toolKey);
    old.remove();
  }
}

function acpScrollEnd(s) {
  if (s._scrollScheduled) return;
  s._scrollScheduled = true;
  requestAnimationFrame(() => {
    s._scrollScheduled = false;
    acpTrim(s);
    // Only follow new content when the user is at/near the bottom, so a message
    // pinned to the middle isn't yanked away by the streaming reply.
    if (s.msgsEl._stick !== false) s.msgsEl.lastElementChild?.scrollIntoView({ block: 'end' });
    updateMsgsFade(s.msgsEl);
  });
}

// New user message → pin its top near the middle of the container (room below for
// the reply), and stop auto-following until the user returns to the bottom.
function acpScrollUserToMiddle(s, el) {
  s.msgsEl._stick = false;
  requestAnimationFrame(() => {
    const cTop = s.msgsEl.getBoundingClientRect().top;
    const eTop = el.getBoundingClientRect().top;
    const target = s.msgsEl.scrollTop + (eTop - cTop) - s.msgsEl.clientHeight * 0.45;
    s.msgsEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  });
}

const ACP_LABELS = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex' };
function renderAcpBanner(s, version, model, cwd) {
  // Drop any prior banner (e.g. when respawning after a model switch)
  s.msgsEl.querySelector('.acp-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'acp-banner';

  const agentLabel = ACP_LABELS[s.agent] || 'Agent';
  const versionStr = version ? `v${version}` : '';
  const modelLine  = model || agentLabel;
  const logo = document.createElement('pre');
  logo.className = 'acp-banner-logo';
  // ASCII blocks → orange (.acp-logo-art); the version/model/path text → shade 0
  logo.innerHTML = [
    `<span class="acp-logo-art"> ▐▛███▜▌   </span>${escHtml(`${agentLabel} ${versionStr}`)}`,
    `<span class="acp-logo-art">▝▜█████▛▘  </span>${escHtml(modelLine)}`,
    `<span class="acp-logo-art">  ▘▘ ▝▝    </span>${escHtml(cwd)}`,
  ].join('\n');
  banner.appendChild(logo);

  const noticesEl = document.createElement('div');
  noticesEl.className = 'acp-banner-notices';
  banner.appendChild(noticesEl);

  s.msgsEl.prepend(banner);
  s._bannerNoticesEl = noticesEl;
  s._bannerCollecting = true;
}

function acpRawLog(_s, _text) {
  // No-op: terminal view is now a real PTY (xterm); text log replaced.
}

// Figma timestamp format, e.g. "6/15/2026 6:23AM"
function formatMsgTime(d) {
  const date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${date} ${h}:${String(d.getMinutes()).padStart(2, '0')}${ampm}`;
}

function acpFinalizeStream(s) {
  if (s.streamEl) {
    const bubble = s.streamEl;
    bubble.classList.remove('streaming');
    const text = (s.streamTextEl ? s.streamTextEl.textContent : '').trim();
    if (text) {
      addReplyMeta(s, bubble, text);
      const isLimit = /\blimit (reached|exceeded|hit)\b|\b(usage|rate|session|message|weekly|hourly) limit\b|reached your .{0,25}\blimit\b/i.test(text);
      Notif.play(isLimit ? 'limit' : 'message');
    }
    s.streamEl = null; s.streamTextEl = null;
    s.streamMsgId = null;
  }
}

// Timestamp row under a completed reply. The copy button is collapsed until the
// bubble/row is hovered, then animates in and pushes the timestamp over. Clicking
// anywhere on the bubble copies it too; the button flips to "COPIED" on copy.
function addReplyMeta(s, bubble, text) {
  let resetTimer = null;
  function doCopy() {
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.innerHTML = 'COPIED';
      copyBtn.classList.add('copied');
      copyBtn.title = 'Copied';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.classList.remove('copied');
        copyBtn.title = 'Copy message';
      }, 1300);
    }).catch(() => {});
  }

  const row = document.createElement('div');
  row.className = 'acp-msg-time';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'acp-msg-copy';
  copyBtn.title = 'Copy message';
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.addEventListener('mousedown', e => e.preventDefault());   // keep text selection
  copyBtn.addEventListener('click', e => { e.stopPropagation(); doCopy(); });

  const timeText = document.createElement('span');
  timeText.className = 'acp-msg-time-text';
  timeText.textContent = formatMsgTime(new Date());

  row.appendChild(copyBtn);
  row.appendChild(timeText);
  s.msgsEl.appendChild(row);

  // Click anywhere on the message copies it — unless the user is selecting text.
  bubble.addEventListener('click', () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    doCopy();
  });
}

const COPY_ICON = '<svg viewBox="0 0 18 18" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12.25 5.75H13.75C14.85 5.75 15.75 6.65 15.75 7.75V13.75C15.75 14.85 14.85 15.75 13.75 15.75H7.75C6.65 15.75 5.75 14.85 5.75 13.75V12.25"></path><path d="M10.25 2.25H4.25C3.15 2.25 2.25 3.15 2.25 4.25V10.25C2.25 11.35 3.15 12.25 4.25 12.25H10.25C11.35 12.25 12.25 11.35 12.25 10.25V4.25C12.25 3.15 11.35 2.25 10.25 2.25Z"></path></svg>';

// Hover copy button for a chat message. `getText` reads the text at click time
// (so it works for still-streaming assistant messages).

// ── Image attachments (chat thumbnails + lightbox) ────────────────
const CHAT_IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
function isChatImage(p) { return CHAT_IMG_EXT.test(p || ''); }
function chatImgMime(p) {
  const ext = (String(p).split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif')  return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg')  return 'image/svg+xml';
  if (ext === 'bmp')  return 'image/bmp';
  return 'image/png';
}
// Load via fs → blob (robust for WSL UNC / drive paths); fall back to file URL.
function loadChatImg(img, filePath) {
  require('fs').promises.readFile(filePath)
    .then(buf => { img.src = URL.createObjectURL(new Blob([buf], { type: chatImgMime(filePath) })); })
    .catch(() => { try { img.src = require('url').pathToFileURL(filePath).href; } catch (_) {} });
}
function openImgLightbox(src, alt) {
  const lb = document.getElementById('img-lightbox');
  const im = document.getElementById('img-lightbox-img');
  if (!lb || !im) return;
  im.src = src; im.alt = alt || '';
  lb.classList.add('open');
}
(function initImgLightbox() {
  const lb = document.getElementById('img-lightbox');
  if (!lb) return;
  const close = () => { lb.classList.remove('open'); };
  const closeBtn = document.getElementById('img-lightbox-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('open')) close(); });
})();
function appendChatImages(el, images) {
  if (!images || !images.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg-imgs';
  images.forEach(p => {
    const name = String(p).split(/[\\/]/).pop();
    const thumb = document.createElement('img');
    thumb.className = 'chat-img-thumb';
    thumb.alt = name; thumb.title = name;
    loadChatImg(thumb, p);
    thumb.addEventListener('click', () => openImgLightbox(thumb.src, name));
    wrap.appendChild(thumb);
  });
  el.appendChild(wrap);
}

function acpAddUserMsg(s, text, images = [], chips = null) {
  s._bannerCollecting = false;
  acpFinalizeStream(s);
  acpRawLog(s, `\n> ${text}\n\n`);
  const el = document.createElement('div');
  el.className = 'acp-msg user';
  if (chips) { const w = buildChatChips(chips.figma, chips.attach); if (w) el.appendChild(w); }
  if (text && text.trim()) {
    const t = document.createElement('div');
    t.className = 'acp-msg-text';
    t.textContent = text;
    el.appendChild(t);
  }
  appendChatImages(el, images);
  s.msgsEl.appendChild(el);
  acpScrollUserToMiddle(s, el);
}

function acpAppendChunk(s, text, messageId) {
  if (s.streamEl && messageId && s.streamMsgId && s.streamMsgId !== messageId) {
    acpFinalizeStream(s);
  }
  if (!s.streamEl) {
    const el = document.createElement('div');
    el.className = 'acp-msg assistant streaming';
    const t = document.createElement('div');
    t.className = 'acp-msg-text';
    el.appendChild(t);
    s.msgsEl.appendChild(el);
    s.streamEl = el; s.streamTextEl = t;
    s.streamMsgId = messageId;
  }
  // Append only the new chunk — reassigning the full accumulated text made
  // long responses O(n²) (full re-serialize + reflow per chunk).
  s.streamTextEl.appendChild(document.createTextNode(text));
  acpRawLog(s, text);
  acpScrollEnd(s);
}

// Shared card shell for tool + terminal updates: a header (name + "Running"
// status) over a body. Returns the parts each caller wires up further.
function makeToolCard(name) {
  const card = document.createElement('div');
  card.className = 'acp-tool';
  const header = document.createElement('div');
  header.className = 'acp-tool-header';
  const nameEl = document.createElement('span');
  nameEl.className = 'acp-tool-name';
  nameEl.textContent = name;
  const statusEl = document.createElement('span');
  statusEl.className = 'acp-tool-status running';
  statusEl.textContent = 'Running';
  header.appendChild(nameEl);
  header.appendChild(statusEl);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'acp-tool-body';
  card.appendChild(header);
  card.appendChild(bodyEl);
  return { card, header, statusEl, bodyEl };
}

function acpAddToolCard(s, update) {
  acpFinalizeStream(s);
  const name = update.title || update.toolCallId || 'tool';
  const { card, header, statusEl, bodyEl } = makeToolCard(name);
  if (update.toolCallId) card.dataset.toolKey = update.toolCallId;   // lets acpTrim drop the toolCards entry
  if (update.content?.type === 'text') bodyEl.textContent = stripAnsi(update.content.text);

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    bodyEl.style.display = collapsed ? 'none' : '';
  });

  s.msgsEl.appendChild(card);
  acpRawLog(s, `\n[${name}]\n`);
  if (update.content?.type === 'text') acpRawLog(s, stripAnsi(update.content.text));
  acpScrollEnd(s);
  s.toolCards.set(update.toolCallId, { card, statusEl, bodyEl });
}

function acpUpdateToolCard(s, update) {
  const tc = s.toolCards.get(update.toolCallId);
  if (!tc) return;
  if (update.status) {
    const done = ['completed', 'done'].includes(update.status);
    const err  = ['error', 'failed'].includes(update.status);
    tc.statusEl.className = `acp-tool-status ${done ? 'done' : err ? 'error' : 'running'}`;
    tc.statusEl.textContent = done ? 'Done' : err ? 'Error' : 'Running';
  }
  if (update.content?.type === 'text') {
    const text = stripAnsi(update.content.text);
    tc.bodyEl.appendChild(document.createTextNode(text));   // append, don't reassign (O(n²))
    tc.bodyEl.scrollTop = tc.bodyEl.scrollHeight;
    acpRawLog(s, text);
  }
}


function acpAddTermCard(s, { termId, title }) {
  if (s.toolCards.has(termId)) return;
  acpFinalizeStream(s);
  const { card, statusEl, bodyEl } = makeToolCard(title || 'terminal');
  card.dataset.toolKey = termId;   // lets acpTrim drop the toolCards entry
  s.msgsEl.appendChild(card);
  acpScrollEnd(s);
  s.toolCards.set(termId, { card, statusEl, bodyEl });
}

function handleAcpUpdate(s, update) {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content?.type === 'text') acpAppendChunk(s, update.content.text, update.messageId);
      break;
    case 'tool_call':        acpAddToolCard(s, update);    break;
    case 'tool_call_update': acpUpdateToolCard(s, update); break;
  }
}

// ── ACP IPC listeners ─────────────────────────────────────────────
ipcRenderer.on('acp-installing', (_, { id }) => {
  const s = acpSession(id);
  if (!s) return;
  acpSetStatus(s, 'installing');
  acpRawLog(s, '⬇ Installing adapter (one-time setup)…\n');
  const el = document.createElement('div');
  el.className = 'acp-msg assistant';
  el.dataset.installLog = 'true';
  const t = document.createElement('div');
  t.className = 'acp-msg-text';
  t.textContent = 'Installing Claude adapter (one-time setup)…';
  el.appendChild(t);
  s.msgsEl.appendChild(el);
  s._installEl = t;
  acpScrollEnd(s);
});

ipcRenderer.on('acp-install-progress', (_, { id, text }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp' || !s._installEl) return;
  s._installEl.appendChild(document.createTextNode(text));
  acpRawLog(s, text);
  acpScrollEnd(s);
});

ipcRenderer.on('acp-ready', (_, { id, version, model, cwd, agent }) => {
  const s = acpSession(id);
  if (!s) return;
  if (agent) s.agent = agent;
  if (s._installEl) {
    s._installEl.remove();
    s._installEl = null;
  }
  s.cwd = cwd || s.cwd || '';
  acpSetStatus(s, 'ready');
  renderAcpBanner(s, version || '', model || '', cwd || '');
  finishModelSwitch(s);  // dismiss "switching…" toast + confirm, if a model switch is pending
});

ipcRenderer.on('acp-update', (_, { id, update }) => {
  const s = sessions.get(id);
  if (s?.type === 'acp') handleAcpUpdate(s, update);
});

ipcRenderer.on('acp-done', (_, { id }) => {
  const s = sessions.get(id);
  if (s?.type === 'acp') { acpFinalizeStream(s); acpRawLog(s, '\n'); acpSetStatus(s, 'ready'); }
  if (id === activeId) refreshUsage();  // update usage after each reply (panel re-reads only if open)
});

ipcRenderer.on('acp-closed', (_, { id }) => {
  const s = sessions.get(id);
  if (s?.type === 'acp') { acpFinalizeStream(s); acpRawLog(s, '\n[Session ended]\n'); acpSetStatus(s, 'closed'); }
});

ipcRenderer.on('acp-error', (_, { id, message }) => {
  const s = acpSession(id);
  if (!s) return;
  if (s._modelToast) { s._modelToast.dismiss(); s._modelToast = null; s._pendingModelLabel = null; }
  acpFinalizeStream(s);
  acpRawLog(s, `\nError: ${message}\n`);
  acpSetStatus(s, 'error');
  const el = document.createElement('div');
  el.className = 'acp-msg error';
  el.textContent = `Error: ${message}`;
  s.msgsEl.appendChild(el);
  acpScrollEnd(s);
});

ipcRenderer.on('acp-tool-approved', (_, { id, toolCall }) => {
  const s = acpSession(id);
  if (!s) return;
  acpFinalizeStream(s);
  const label = toolCall?.title || toolCall?.input?.command || 'tool';
  acpRawLog(s, `▶ ${label}\n`);
  const el = document.createElement('div');
  el.className = 'acp-approved';
  el.textContent = `▶ ${label}`;
  s.msgsEl.appendChild(el);
  acpScrollEnd(s);
});

ipcRenderer.on('acp-term-create', (_, { id, termId, title }) => {
  const s = acpSession(id);
  if (!s) return;
  acpRawLog(s, `\n[terminal: ${title || termId}]\n`);
  acpAddTermCard(s, { termId, title });
});

ipcRenderer.on('acp-term-output', (_, { id, termId, output }) => {
  const s = acpSession(id);
  if (!s) return;
  const stripped = stripAnsi(output);
  // Collect ▎ notice lines from startup banner output
  if (s._bannerCollecting && s._bannerNoticesEl) {
    for (const line of stripped.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('▎') || trimmed.startsWith('▏')) {
        const d = document.createElement('div');
        d.className = 'acp-banner-notice';
        d.textContent = line.replace(/^\s*[▎▏]\s?/, '').trim();
        s._bannerNoticesEl.appendChild(d);
      }
    }
  }
  const tc = s.toolCards.get(termId);
  if (tc) { tc.bodyEl.appendChild(document.createTextNode(stripped)); tc.bodyEl.scrollTop = tc.bodyEl.scrollHeight; }
});

ipcRenderer.on('acp-term-release', (_, { id, termId }) => {
  const s = acpSession(id);
  if (!s) return;
  const tc = s.toolCards.get(termId);
  if (tc) { tc.statusEl.className = 'acp-tool-status done'; tc.statusEl.textContent = 'Done'; }
});

// Boot first session
createSession();

function scanBufferForBullets(_id) { return false; }
function updateChatAi(_id) {}

// ── Divider drag ──────────────────────────────────────────────────
const divider   = document.getElementById('divider');
const leftPanel = document.getElementById('left-panel');
const appRootEl = document.getElementById('app');
const devtoolsPlaceholderEl = document.getElementById('devtools-placeholder');
let dragging = false;
let currentDevToolsWidth = 0;

// devtools-layout streams continuously during divider drags and the DevTools
// open/close animation. Refit the PTY once, trailing — fitAddon.fit()
// measures the DOM and resizes the shell, far too heavy to run per event.
let layoutRefitTimer = null;
ipcRenderer.on('devtools-layout', (_, { leftPanelWidth, devToolsWidth: dw }) => {
  currentDevToolsWidth = dw;
  leftPanel.style.width = leftPanelWidth + 'px';
  devtoolsPlaceholderEl.style.width = dw + 'px';
  clearTimeout(layoutRefitTimer);
  layoutRefitTimer = setTimeout(() => refitSession(activeId), 80);
});

divider.addEventListener('mousedown', e => {
  dragging = true;
  divider.classList.add('dragging');
  leftPanel.style.transition = 'none';
  e.preventDefault();
});
// rAF-throttled: mousemove fires at 60–120 Hz; each un-throttled event caused
// a style write + IPC → 4 native setBounds in main. One update per frame.
let dragClientX = 0, dragRaf = 0;
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  dragClientX = e.clientX;
  if (dragRaf) return;
  dragRaf = requestAnimationFrame(() => {
    dragRaf = 0;
    if (!dragging) return;
    const appW     = appRootEl.offsetWidth - currentDevToolsWidth;
    const fraction = Math.min(0.75, Math.max(0.2, dragClientX / appW));
    leftPanel.style.width = Math.round(fraction * appW) + 'px';
    ipcRenderer.send('split-changed', fraction);
  });
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove('dragging');
  leftPanel.style.transition = '';
  refitSession(activeId);
});

// ── Panel collapse toggle ─────────────────────────────────────────
const btnPanelToggle = document.getElementById('btn-panel-toggle');
let panelCollapsed = false;
let savedPanelWidth = null;

btnPanelToggle.addEventListener('click', () => {
  panelCollapsed = !panelCollapsed;
  if (panelCollapsed) {
    savedPanelWidth = leftPanel.style.width || null;
    leftPanel.classList.add('collapsed');
    btnPanelToggle.classList.add('collapsed');
    ipcRenderer.send('split-changed', 0);
  } else {
    leftPanel.classList.remove('collapsed');
    btnPanelToggle.classList.remove('collapsed');
    if (savedPanelWidth) leftPanel.style.width = savedPanelWidth;
    setTimeout(() => {
      const w = leftPanel.offsetWidth;
      ipcRenderer.send('split-changed', w / appRootEl.offsetWidth);
    }, 250);
  }
  refitSession(activeId, PANEL_ANIM_MS);
});

// ── Settings dropdown ─────────────────────────────────────────────
// ── Custom window controls (frameless titlebar) ──────────────────
(function initWindowControls() {
  const wc = document.getElementById('window-controls');
  if (!wc) return;
  document.getElementById('wc-minimize').addEventListener('click', () => ipcRenderer.send('window-minimize'));
  document.getElementById('wc-maximize').addEventListener('click', () => ipcRenderer.send('window-maximize-toggle'));
  document.getElementById('wc-close').addEventListener('click', () => ipcRenderer.send('window-close'));
  ipcRenderer.on('window-maximized-state', (_, max) => wc.classList.toggle('maximized', !!max));
})();

// ── Views control bar — wires the LED toggles to their views ──────
// Proxies the original controls (still in the DOM) so existing show/hide +
// persistence logic stays intact. Unavailable views remove their toggle (TODO).
(function initViewsBar() {
  const bar = document.getElementById('views-toggles');
  if (!bar) return;
  const toggles = {};
  bar.querySelectorAll('.vt-switch').forEach((sw) => { toggles[sw.dataset.view] = sw; });
  const setOn = (view, on) => {
    const sw = toggles[view]; if (!sw) return;
    sw.classList.toggle('on', !!on);
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  const isOn  = (v) => !!(toggles[v] && toggles[v].classList.contains('on'));
  const proxy = (id) => { const b = document.getElementById(id); if (b) b.click(); };
  const sysOn = () => { const b = document.getElementById('btn-sysperf-toggle'); return !!b && b.classList.contains('active'); };   // active class is set synchronously; panel display lags behind the grow/shrink animation
  window.__setViewToggle = setOn;   // allow other code (e.g. session sync) to keep these in step

  toggles.usage  && toggles.usage.addEventListener('click',  () => { proxy('btn-usage');           setOn('usage', usageOpen); });
  toggles.system && toggles.system.addEventListener('click', () => { proxy('btn-sysperf-toggle');  setOn('system', sysOn()); });
  toggles.devtools && toggles.devtools.addEventListener('click', () => proxy('btn-devtools'));
  ipcRenderer.on('devtools-opened', () => setOn('devtools', true));
  ipcRenderer.on('devtools-closed', () => setOn('devtools', false));
  toggles.terminal && toggles.terminal.addEventListener('click', () => {
    const wantTerm = !isOn('terminal');
    const tab = document.querySelector('#session-view-toggle .svt-tab[data-view="' + (wantTerm ? 'term' : 'chat') + '"]');
    if (tab) tab.click();
    setOn('terminal', wantTerm);
  });

  // Reflect actual panel state once all panel inits have run.
  setTimeout(() => {
    if (!usageOpen) proxy('btn-usage');     // start the usage graph on
    setOn('usage', usageOpen);
    setOn('system', sysOn());
    const dt = document.getElementById('btn-devtools');
    setOn('devtools', !!dt && dt.classList.contains('active'));
  }, 0);
})();

const gearBtn      = document.getElementById('btn-settings');
const apiKeyModal  = document.getElementById('api-key-modal');
const apiKeyInput  = document.getElementById('api-key-input');

gearBtn.addEventListener('click', e => {
  e.stopPropagation();
  const rect = gearBtn.getBoundingClientRect();
  ipcRenderer.send('show-settings-menu', { x: Math.round(rect.left), y: Math.round(rect.bottom) });
});

let openAuditPromptsModal      = null;
let openEditTabsModal          = null;
let openMcpToolsModal          = null;
let openKeyboardShortcutsModal = null;

ipcRenderer.on('settings-action', (_, action) => {
  switch (action) {
    case 'api-key': {
      const saved = secureGet(LS.apiKey) || '';
      apiKeyInput.value = saved;
      apiKeyModalCtl.open();
      requestAnimationFrame(() => apiKeyInput.focus());
      break;
    }
    case 'manage-llms':   openProfilesModal?.();     break;
    case 'get-started':   openOnboarding?.();        break;
    case 'auth':          openAuthModal();           break;
    case 'claude-md':     openClaudeMdModal();       break;
    case 'audit-prompts': openAuditPromptsModal?.(); break;
    case 'edit-tabs':     openEditTabsModal?.();     break;
    case 'mcp-tools':          openMcpToolsModal?.();          break;
    case 'keyboard-shortcuts': openKeyboardShortcutsModal?.(); break;
    case 'edit-devices':       openEditDevicesModal?.();       break;
    case 'theme-minimal': applyTheme('minimal'); break;
    case 'theme-winamp':  applyTheme('winamp');  break;
    case 'new-window':    ipcRenderer.send('new-window'); break;
  }
});

const apiKeyModalCtl = wireModal(apiKeyModal);
const closeApiKeyModal = apiKeyModalCtl.close;

document.getElementById('api-key-cancel').addEventListener('click', closeApiKeyModal);

document.getElementById('api-key-confirm').addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    secureSet(LS.apiKey, key);
    ipcRenderer.send('set-api-key', key);
  }
  closeApiKeyModal();
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('api-key-confirm').click();
  if (e.key === 'Escape') closeApiKeyModal();
});

// ── API Keys modal ────────────────────────────────────────────────
const API_KEYS_STORE = LS.apiKeys;

// Secrets in localStorage are sealed by the main process (safeStorage) so they
// aren't readable at rest; sendSync keeps these accessors synchronous. Legacy
// plaintext is read as-is and re-sealed on the next write.
function secureGet(k) {
  const raw = localStorage.getItem(k);
  if (!raw) return '';
  try { return ipcRenderer.sendSync('secret-open', raw); } catch (_) { return raw; }
}
function secureSet(k, v) {
  try { localStorage.setItem(k, ipcRenderer.sendSync('secret-seal', String(v))); }
  catch (_) { localStorage.setItem(k, String(v)); }
}

function loadApiKeys() {
  try { const r = secureGet(API_KEYS_STORE); if (r) return JSON.parse(r); } catch (_) {}
  const legacy = secureGet(LS.apiKey);
  if (legacy) {
    const keys = [{ id: `k${Date.now()}`, name: 'Default', key: legacy, active: true }];
    secureSet(API_KEYS_STORE, JSON.stringify(keys));
    return keys;
  }
  return [];
}

function persistApiKeys(keys) {
  secureSet(API_KEYS_STORE, JSON.stringify(keys));
  const active = keys.find(k => k.active);
  if (active) {
    secureSet(LS.apiKey, active.key);
    ipcRenderer.send('set-api-key', active.key);
  }
}

function maskKey(key) {
  if (!key || key.length <= 12) return '•'.repeat(Math.min((key || '').length, 12));
  return key.slice(0, 8) + '…' + key.slice(-4);
}

function renderApiKeysList() {
  const listEl = document.getElementById('api-keys-list');
  const keys = loadApiKeys();
  listEl.innerHTML = '';
  if (!keys.length) {
    listEl.innerHTML = '<p class="modal-desc" style="margin:8px 0;opacity:0.55">No keys saved yet — add one below.</p>';
    return;
  }
  keys.forEach(k => {
    const item = document.createElement('div');
    item.className = 'api-key-item' + (k.active ? ' active' : '');
    item.innerHTML = `
      <div class="api-key-dot"></div>
      <div class="api-key-info">
        <span class="api-key-label">${escHtml(k.name)}</span>
        <span class="api-key-masked">${escHtml(maskKey(k.key))}</span>
      </div>
      <button class="api-key-use" ${k.active ? 'disabled' : ''}>${k.active ? 'Active' : 'Use'}</button>
      <button class="api-key-del" title="Remove">✕</button>
    `;
    item.querySelector('.api-key-use').addEventListener('click', () => {
      const all = loadApiKeys();
      all.forEach(x => { x.active = x.id === k.id; });
      persistApiKeys(all);
      renderApiKeysList();
    });
    item.querySelector('.api-key-del').addEventListener('click', () => {
      let all = loadApiKeys().filter(x => x.id !== k.id);
      if (k.active && all.length) { all[0].active = true; persistApiKeys(all); }
      else secureSet(API_KEYS_STORE, JSON.stringify(all));
      renderApiKeysList();
    });
    listEl.appendChild(item);
  });
}

const authModal     = document.getElementById('auth-modal');
const apiKeyNewForm = document.getElementById('api-key-new-form');

async function renderAuthAccountSection() {
  const el = document.getElementById('auth-account-status');
  el.innerHTML = '<span class="auth-loading">Checking…</span>';
  const creds = await ipcRenderer.invoke('auth-status-read');
  const oauth        = creds?.claudeAiOauth ?? creds;
  const hasToken     = !!(oauth?.accessToken);
  const expiresAt    = oauth?.expiresAt;
  const expired      = expiresAt && Date.now() > expiresAt;
  const loggedIn     = hasToken && !expired;
  const subType      = oauth?.subscriptionType || '';
  const email        = oauth?.account?.emailAddress || oauth?.email || '';
  const subLabel     = subType === 'pro' ? 'Claude Pro' : subType ? subType : 'claude.ai';
  const displayName  = email || subLabel;
  const subLine      = email ? subLabel : '';

  el.innerHTML = `
    <div class="auth-account-row${loggedIn ? ' active' : ''}">
      <div class="auth-dot${loggedIn ? ' on' : ''}"></div>
      <div class="auth-account-info">
        <span class="auth-account-name">${loggedIn ? displayName : 'Not logged in'}</span>
        ${loggedIn && subLine ? `<span class="auth-account-sub">${subLine}</span>` : ''}
        ${expired  ? `<span class="auth-account-sub warn">Session expired — re-authenticate</span>` : ''}
        ${!hasToken ? `<span class="auth-account-sub">Run claude auth login to connect your account</span>` : ''}
      </div>
      <button class="api-key-use auth-reauth-btn">${loggedIn ? 'Re-auth' : 'Log in'}</button>
    </div>
  `;
  el.querySelector('.auth-reauth-btn').addEventListener('click', () => {
    authModalCtl.close();
    createSession('Claude Auth', 'claude auth login', false);
  });
}

const authModalCtl = wireModal(authModal);

async function openAuthModal() {
  renderAuthAccountSection();
  renderApiKeysList();
  apiKeyNewForm.style.display = 'none';
  authModalCtl.open();
}

document.getElementById('api-key-new-open').addEventListener('click', () => {
  const open = apiKeyNewForm.style.display === 'none';
  apiKeyNewForm.style.display = open ? '' : 'none';
  if (open) {
    document.getElementById('api-key-new-name').value = '';
    document.getElementById('api-key-new-value').value = '';
    document.getElementById('api-key-new-name').focus();
  }
});

function commitNewApiKey() {
  const name = document.getElementById('api-key-new-name').value.trim();
  const key  = document.getElementById('api-key-new-value').value.trim();
  if (!name || !key) return;
  const keys = loadApiKeys();
  const isFirst = !keys.length;
  keys.push({ id: `k${Date.now()}`, name, key, active: isFirst });
  if (isFirst) persistApiKeys(keys);
  else secureSet(API_KEYS_STORE, JSON.stringify(keys));
  apiKeyNewForm.style.display = 'none';
  renderApiKeysList();
}

document.getElementById('api-key-new-save').addEventListener('click', commitNewApiKey);
document.getElementById('api-key-new-cancel').addEventListener('click', () => { apiKeyNewForm.style.display = 'none'; });
document.getElementById('api-key-new-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('api-key-new-value').focus();
});
document.getElementById('api-key-new-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') commitNewApiKey();
  if (e.key === 'Escape') { apiKeyNewForm.style.display = 'none'; }
});
document.getElementById('auth-done').addEventListener('click', () => authModalCtl.close());

// ── CLAUDE.md editor modal ────────────────────────────────────────
const claudeMdModal    = document.getElementById('claude-md-modal');
const claudeMdTextarea = document.getElementById('claude-md-textarea');
const claudeMdTitle    = document.getElementById('claude-md-title');
const claudeMdDesc     = document.getElementById('claude-md-desc');

const claudeMdModalCtl = wireModal(claudeMdModal);

const MEMORY_FILE  = { claude: 'CLAUDE.md', gemini: 'GEMINI.md', codex: 'AGENTS.md' };
const MEMORY_LABEL = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex' };
let memoryAgent = 'claude';   // which agent's memory file the modal is editing

async function openMemoryModal(agent = 'claude') {
  memoryAgent = agent;
  const file  = MEMORY_FILE[agent] || 'AGENTS.md';
  const label = MEMORY_LABEL[agent] || agent;
  if (claudeMdTitle) claudeMdTitle.textContent = `Edit ${file}`;
  if (claudeMdDesc)  claudeMdDesc.innerHTML = `Instructions for ${escHtml(label)} — written to its <code>${escHtml(file)}</code>.`;
  claudeMdTextarea.value = '';
  claudeMdTextarea.placeholder = 'Loading…';
  claudeMdModalCtl.open();
  const content = await ipcRenderer.invoke('agent-md-read', { agent });
  if (memoryAgent !== agent) return;   // a newer open superseded this
  claudeMdTextarea.value = content;
  claudeMdTextarea.placeholder = `# Agent Instructions\n\nWrite instructions for ${label} here…`;
  claudeMdTextarea.focus();
}
// Back-compat shim (settings menu still calls this for Claude).
const openClaudeMdModal = () => openMemoryModal('claude');

document.getElementById('claude-md-cancel').addEventListener('click', () => claudeMdModalCtl.close());
document.getElementById('claude-md-save').addEventListener('click', async () => {
  const btn = document.getElementById('claude-md-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const ok = await ipcRenderer.invoke('agent-md-write', { agent: memoryAgent, content: claudeMdTextarea.value });
  btn.disabled = false;
  btn.textContent = 'Save';
  if (ok) claudeMdModalCtl.close();
});

ipcRenderer.on('edit-agent-memory', (_, agent) => openMemoryModal(agent || 'claude'));

// ── Right panel view switching ────────────────────────────────────
const tabBar            = document.getElementById('tab-bar');
const rightSb           = document.getElementById('right-storybook');
const browserPlaceholder = document.getElementById('browser-placeholder');
const codePanel         = document.getElementById('code-panel');
const consolePanel      = document.getElementById('console-panel');
const diffPanel         = document.getElementById('diff-panel');

const viewTabThumb = document.getElementById('view-tab-thumb');

function updateViewTabThumb() {
  const active = document.querySelector('.view-tab.active');
  if (!active || !viewTabThumb) return;
  viewTabThumb.style.left  = active.offsetLeft + 'px';
  viewTabThumb.style.width = active.offsetWidth + 'px';
}

// ── Tab configuration ──────────────────────────────────────────────
// TAB_TYPES is the single catalog for built-in view-tab types: the default
// config, the Edit Tabs modal (defaults + add-options), and the icon map all
// derive from it. To add a tab type: add it here, then handle its panel in
// activateViewTab (and main.js right-panel-mode if it needs a native view).
const TAB_ICONS = {
  project:   `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><path opacity="0.4" d="M9.5 5.5C9.5 3.96 8.573 2.65005 7.25 2.06995V5.75H4.25V2.06995C2.927 2.65005 2 3.9599 2 5.5C2 7.0401 2.927 8.34995 4.25 8.93005V15.25C4.25 15.8 4.698 16.25 5.25 16.25H6.25C6.802 16.25 7.25 15.8 7.25 15.25V8.93005C8.573 8.34995 9.5 7.0401 9.5 5.5Z" fill="currentColor" stroke="none"/><path opacity="0.4" d="M15.25 9.25V15.25C15.25 15.8 14.802 16.25 14.25 16.25H13.25C12.698 16.25 12.25 15.8 12.25 15.25V9.25" fill="currentColor" stroke="none"/><path d="M9.5 5.5C9.5 3.96 8.573 2.65005 7.25 2.06995V5.75H4.25V2.06995C2.927 2.65005 2 3.9599 2 5.5C2 7.0401 2.927 8.34995 4.25 8.93005V15.25C4.25 15.8 4.698 16.25 5.25 16.25H6.25C6.802 16.25 7.25 15.8 7.25 15.25V8.93005C8.573 8.34995 9.5 7.0401 9.5 5.5Z"/><path d="M15.25 9.25V15.25C15.25 15.8 14.802 16.25 14.25 16.25H13.25C12.698 16.25 12.25 15.8 12.25 15.25V9.25"/><path d="M11.25 9.25H16.25"/><path d="M13.75 9.25V2.25"/><path d="M13.75 5.25L14.75 3.5L14.25 1.75H13.25L12.75 3.5L13.75 5.25Z" fill="currentColor"/></g></svg>`,
  figma:     `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7.60001 14.4262V13.1137H6.28653C5.56228 13.1138 4.97418 13.7019 4.97403 14.4262C4.97403 15.1506 5.56219 15.7395 6.28653 15.7397V17.1401L6.00919 17.1254C4.64178 16.9862 3.57364 15.8301 3.57364 14.4262C3.57379 12.9287 4.78908 11.7135 6.28653 11.7133H9.0004V14.4262L8.98575 14.7035C8.84681 16.0712 7.69066 17.1401 6.28653 17.1401V15.7397C7.011 15.7397 7.60001 15.1507 7.60001 14.4262Z" fill="currentColor"/><path d="M3.57364 8.99986C3.57379 7.50241 4.78908 6.28712 6.28653 6.28697H9.0004V11.7137H6.28653V10.3133H7.60001V7.68736H6.28653C5.56228 7.68751 4.97418 8.27561 4.97403 8.99986C4.97403 9.72424 5.56219 10.3132 6.28653 10.3133V11.7137L6.00919 11.6991C4.64178 11.5599 3.57364 10.4038 3.57364 8.99986Z" fill="currentColor"/><path d="M3.57364 3.57353C3.57379 2.07608 4.78908 0.86079 6.28653 0.860641H9.0004V6.2874H6.28653V4.88701H7.60001V2.26103H6.28653C5.56228 2.26118 4.97418 2.84928 4.97403 3.57353C4.97403 4.29791 5.56219 4.88686 6.28653 4.88701V6.2874L6.00919 6.27275C4.64178 6.13356 3.57364 4.97747 3.57364 3.57353Z" fill="currentColor"/><path d="M11.7135 2.26076C12.4377 2.26087 13.0257 2.84904 13.026 3.57326C13.026 4.29766 12.4378 4.88662 11.7135 4.88673H8.74548V6.29658L11.7135 6.28712L11.9908 6.27248C13.3582 6.13332 14.4263 4.97722 14.4263 3.57326C14.4261 2.16945 13.3581 1.01315 11.9908 0.874039L11.7135 0.860367L8.74548 0.883499V2.27022L11.7135 2.26076Z" fill="currentColor"/><path d="M13.0264 8.99986C13.0262 8.27552 12.4373 7.68736 11.7129 7.68736C10.9887 7.68751 10.4006 8.27561 10.4004 8.99986C10.4004 9.72424 10.9886 10.3132 11.7129 10.3133V11.7137L11.4356 11.6991C10.0682 11.5599 9.00003 10.4038 9.00003 8.99986C9.00018 7.50241 10.2155 6.28712 11.7129 6.28697C13.2105 6.28697 14.4266 7.50232 14.4268 8.99986L14.4121 9.27721C14.2732 10.6449 13.117 11.7137 11.7129 11.7137V10.3133C12.4374 10.3133 13.0264 9.72433 13.0264 8.99986Z" fill="currentColor"/></svg>`,
  storybook: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="m9,15.051c.17,0,.339-.045.494-.134.643-.371,1.732-.847,3.141-.845.899.001,1.667.197,2.27.435.648.255,1.344-.24,1.344-.937V4.487c0-.354-.181-.68-.486-.86-.5393-.3183-1.4027-.7163-2.513-.8308"/><path d="m9,15.051c-.17,0-.339-.045-.494-.134-.643-.371-1.732-.847-3.141-.845-.899.001-1.667.197-2.27.435-.648.255-1.344-.237-1.344-.933V4.484c0-.354.181-.676.486-.856.637-.376,1.726-.863,3.14-.863,1.89,0,3.198.872,3.624,1.182"/><path d="m8.999,15.051c.6301-1.3222,1.9537-2.2143,3.6105-2.3971.3692-.0407.6405-.3676.6405-.739V2.3259c0-.4569-.4081-.8165-.8599-.7486-1.5127.2275-2.7746,1.0598-3.3911,2.3686v11.105Z"/></g></svg>`,
  url:       `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><circle cx="9" cy="9" r="7"/><path d="M9 2c0 0-2.5 3-2.5 7s2.5 7 2.5 7"/><path d="M9 2c0 0 2.5 3 2.5 7S9 16 9 16"/><line x1="2" y1="9" x2="16" y2="9"/><path d="M2.75 6h12.5"/><path d="M2.75 12h12.5"/></g></svg>`,
  code:      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><rect x="1.75" y="2.75" width="14.5" height="12.5" rx="2"/><circle cx="4.25" cy="5.25" r=".75" fill="currentColor" stroke="none"/><circle cx="6.75" cy="5.25" r=".75" fill="currentColor" stroke="none"/><polyline points="10.75 12.25 13 10 10.75 7.75"/><polyline points="7.25 12.25 5 10 7.25 7.75"/></g></svg>`,
  console:   `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><rect x="1.75" y="2.75" width="14.5" height="12.5" rx="2"/><polyline points="4.75 7 7.25 9 4.75 11"/><line x1="8.75" y1="11.5" x2="12.5" y2="11.5"/></g></svg>`,
  diff:      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><circle cx="4.75" cy="4" r="1.75"/><circle cx="4.75" cy="14" r="1.75"/><path d="M4.75 5.75v6.5"/><path d="M13.25 14V8.5c0-1.1-.9-2-2-2H8.5"/><polyline points="10.5 4.25 8 6.5 10.5 8.75"/></g></svg>`,
};

function toRoman(n) {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r = '';
  vals.forEach((v, i) => { while (n >= v) { r += syms[i]; n -= v; } });
  return r;
}

function getTabIconHtml(tab) {
  if (tab.type === 'url' && tab.url) {
    try {
      const { hostname } = new URL(tab.url);
      return `<img class="tab-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=16" width="14" height="14" />`;
    } catch (_) {}
  }
  return TAB_ICONS[tab.type] || TAB_ICONS.url;
}

function equalizeTabWidths() {
  const container   = document.getElementById('right-panel-tabs');
  const tabs        = [...container.querySelectorAll('.view-tab')];
  if (!tabs.length) return;

  const appBar      = document.getElementById('app-bar');
  const settingsBtn = document.getElementById('btn-settings');
  const rightTools  = document.getElementById('window-controls');

  // Reset to natural size for measurement
  container.style.maxWidth = '';
  tabs.forEach(t => { t.style.width = ''; });

  // Centered tab bar must not overlap the tools on either side.
  // Left boundary = the settings button; right boundary = the window controls.
  const center     = appBar.offsetWidth / 2;
  const rightLimit = (rightTools ? rightTools.offsetLeft : appBar.offsetWidth) - 10;
  const leftLimit  = settingsBtn.offsetLeft + settingsBtn.offsetWidth + 10;
  const halfAvail  = Math.min(rightLimit - center, center - leftLimit);
  const maxWidth   = Math.max(80, 2 * halfAvail);

  const containerPad = 4; // 2px padding each side
  const available    = maxWidth - containerPad;
  const naturalMax   = Math.max(...tabs.map(t => t.offsetWidth));
  const perTab = naturalMax * tabs.length <= available
    ? naturalMax
    : Math.max(50, Math.floor(available / tabs.length));

  container.style.maxWidth = maxWidth + 'px';
  tabs.forEach(t => { t.style.width = perTab + 'px'; });
}

const TAB_TYPES = {
  project:   { label: 'Working File' },
  code:      { label: 'Code Viewer' },
  diff:      { label: 'Changes' },
  console:   { label: 'Console' },
  figma:     { label: 'Figma' },
  storybook: { label: 'Storybook' },
};
const BUILTIN_TAB_ORDER = Object.keys(TAB_TYPES);

function defaultTabFor(type) {
  return { id: type, type, label: TAB_TYPES[type].label };
}

// Code Viewer is opt-in — not a default tab (add it via Edit Tabs). The Changes
// tab covers diffs, which is what most people reach the Code Viewer for.
const DEFAULT_TABS_CONFIG = BUILTIN_TAB_ORDER.filter(t => t !== 'code').map(defaultTabFor);

let tabsConfig = (() => {
  try {
    const s = localStorage.getItem(LS.tabs);
    if (s) {
      const cfg = JSON.parse(s);
      if (Array.isArray(cfg)) {
        let changed = false;
        // Code Viewer is no longer a default tab — retire the auto-added default
        // once. Renamed/custom code tabs are left alone, and it can be re-added.
        if (!localStorage.getItem('cathode-code-tab-retired')) {
          const ci = cfg.findIndex(t => t.type === 'code' && (t.label === 'Code' || t.label === 'Code Viewer'));
          if (ci !== -1) { cfg.splice(ci, 1); changed = true; }
          localStorage.setItem('cathode-code-tab-retired', '1');
        }
        // Ensure the Changes (diff) tab exists (after Working File) for older configs.
        if (!cfg.find(t => t.type === 'diff')) {
          const at = Math.max(0, cfg.findIndex(t => t.type === 'project')) + 1;
          cfg.splice(at, 0, defaultTabFor('diff'));
          changed = true;
        }
        // Ensure the Console tab exists (after the Changes tab) for older configs.
        if (!cfg.find(t => t.type === 'console')) {
          const at = Math.max(0, cfg.findIndex(t => t.type === 'diff')) + 1;
          cfg.splice(at, 0, defaultTabFor('console'));
          changed = true;
        }
        if (changed) localStorage.setItem(LS.tabs, JSON.stringify(cfg));
      }
      return cfg;
    }
  } catch (_) {}
  return DEFAULT_TABS_CONFIG.map(t => ({ ...t }));
})();

let activeViewTabId = tabsConfig[0]?.id || 'project';

const projectToolsEl = document.getElementById('project-tools');

function setProjectToolsVisible(visible, animate) {
  const btns = Array.from(projectToolsEl.querySelectorAll('.pick-btn'));
  gsap.killTweensOf([projectToolsEl, ...btns]);

  if (!animate) {
    gsap.set(projectToolsEl, visible ? { clearProps: 'width' } : { width: 0 });
    gsap.set(btns,           visible ? { clearProps: 'opacity' } : { opacity: 0 });
    return;
  }

  if (visible) {
    // Measure natural width synchronously: clear constraint → read → restore before next paint
    gsap.set(projectToolsEl, { clearProps: 'width' });
    const naturalW = projectToolsEl.offsetWidth;
    gsap.set(projectToolsEl, { width: 0 });

    gsap.timeline()
      .set(btns, { opacity: 0 })
      .to(projectToolsEl, { width: naturalW, duration: 0.22, ease: 'power2.out' })
      .to(btns, { opacity: 1, duration: 0.18, ease: 'power1.in' });
  } else {
    gsap.timeline()
      .to(btns, { opacity: 0, duration: 0.09, ease: 'power1.out' })
      .to(projectToolsEl, { width: 0, duration: 0.14, ease: 'power2.in' });
  }
}

function activateViewTab(tabId, silent = false) {
  activeViewTabId = tabId;
  const tab = tabsConfig.find(t => t.id === tabId);
  if (!tab) return;
  document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === tabId));
  updateViewTabThumb();
  const isProject   = tab.type === 'project';
  const isStorybook = tab.type === 'storybook';
  const isCode      = tab.type === 'code';
  const isConsole   = tab.type === 'console';
  const isDiff      = tab.type === 'diff';
  tabBar.style.display             = isProject   ? '' : 'none';
  rightSb.style.display            = isStorybook ? 'flex' : 'none';
  browserPlaceholder.style.display = isProject   ? '' : 'none';
  if (codePanel) codePanel.style.display = isCode ? 'flex' : 'none';
  if (consolePanel) consolePanel.style.display = isConsole ? 'flex' : 'none';
  if (diffPanel) diffPanel.style.display = isDiff ? 'flex' : 'none';
  setProjectToolsVisible(isProject, !silent);
  // The Code Viewer, Console and Changes tabs have no live web page, so none of
  // the page tools apply — hide every always-visible pick tool there.
  // `disabled` also blocks their Alt-hotkeys.
  const noPageTools = isCode || isConsole || isDiff;
  document.querySelectorAll('#toolbar > .pick-btn').forEach(b => {
    b.style.display = noPageTools ? 'none' : '';
    b.disabled = noPageTools;
  });
  if (isCode) window.__onCodeTabActive?.();
  else window.__onCodeTabInactive?.();
  if (isConsole) window.__onConsoleTabActive?.();
  if (isDiff) window.__onDiffTabActive?.();
  if (!silent) {
    const mode = tab.type === 'url' ? 'url:' + tab.url : tab.type;
    ipcRenderer.send('right-panel-mode', mode);
    updateWfEmpty();   // re-evaluate when the user switches view tabs (guarded to user actions to avoid init TDZ)
  }
}

// Each tab icon's art sits differently inside its viewBox, so a fixed flex gap
// yields inconsistent visual spacing. Measure each glyph's real bbox and pull
// the label to a uniform 8px from the glyph (negative margins — no rescaling,
// so stroke weights are untouched). Left margin aligns the glyphs' left edges too.
function alignTabIconGaps() {
  document.querySelectorAll('#right-panel-tabs .view-tab > svg').forEach(svg => {
    svg.style.marginLeft = '';
    svg.style.marginRight = '';
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width) return;
    let bbox;
    try { bbox = svg.getBBox(); } catch (_) { return; }
    if (!bbox || !bbox.width) return;
    const scale    = 16 / vb.width;   // .view-tab svg renders at 16px
    const leftPad  = (bbox.x - vb.x) * scale;
    const rightPad = ((vb.x + vb.width) - (bbox.x + bbox.width)) * scale;
    svg.style.marginLeft  = (-leftPad).toFixed(2)  + 'px';
    svg.style.marginRight = (-rightPad).toFixed(2) + 'px';
  });
}

function renderViewTabs() {
  const container = document.getElementById('right-panel-tabs');
  container.querySelectorAll('.view-tab').forEach(b => b.remove());
  tabsConfig.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'view-tab' + (tab.id === activeViewTabId ? ' active' : '');
    btn.dataset.view = tab.id;
    btn.innerHTML = `<span class="vt-blob"></span>${getTabIconHtml(tab)}<span class="view-tab-label">${escHtml(tab.label)}</span>`;
    btn.addEventListener('click', () => activateViewTab(tab.id));
    container.appendChild(btn);
  });
  requestAnimationFrame(() => { alignTabIconGaps(); equalizeTabWidths(); updateViewTabThumb(); });
}

renderViewTabs();
activateViewTab(activeViewTabId, true);

window.addEventListener('resize', () => { equalizeTabWidths(); updateViewTabThumb(); });

document.getElementById('right-panel-tabs').addEventListener('contextmenu', e => {
  e.preventDefault();
  ipcRenderer.send('show-tabs-context-menu', { x: e.clientX, y: e.clientY });
});

// ── Browser tabs & address bar ────────────────────────────────────
const addressBar    = document.getElementById('address-bar');
const tabsContainer = document.getElementById('tabs-container');
let tabs        = [];
let activeTabId = null;
let nextTabId   = 1;

// ── Working File empty state ──────────────────────────────────────
const wfEmpty    = document.getElementById('wf-empty');
const wfUrl      = document.getElementById('wf-url');
const wfCloneRow = document.getElementById('wf-clone-row');
const wfRepo     = document.getElementById('wf-repo');

function projectTabActive() {
  const t = tabsConfig.find(t => t.id === activeViewTabId);
  return !!(t && t.type === 'project');
}
function browserIsBlank() {
  const t = tabs.find(t => t.id === activeTabId);
  const url = t ? t.url : '';
  return !url || url === 'about:blank';
}
function updateWfEmpty() {
  const empty = projectTabActive() && browserIsBlank();
  wfEmpty.classList.toggle('visible', empty);
  if (!empty) wfCloneRow.classList.remove('visible');
  // Nothing loaded → the pick tools have nothing to act on: show them inactive.
  document.getElementById('toolbar')?.classList.toggle('tools-inactive', empty);
  ipcRenderer.send('set-browser-empty', empty);
}

// Hand a task to the active agent (fills the composer, ready to review + send)
// Send a task straight to the active agent
function sendToAgent(text) {
  uiTextarea.value = text;
  sendUiMessage();
}

function wfOpen() {
  const v = wfUrl.value.trim();
  if (!v) { wfUrl.focus(); return; }
  ipcRenderer.send('browser-navigate', v);
}
document.getElementById('wf-go').addEventListener('click', wfOpen);
wfUrl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); wfOpen(); } });

document.getElementById('wf-serve').addEventListener('click', () => {
  wfCloneRow.classList.remove('visible');
  sendToAgent("I want to run a local dev server and view it here in the Working File. First, ask me which repository or project folder you should use. Once I've told you, start that project's dev server on a free, open localhost port and reply with the exact http://localhost:<port> URL so I can open it.");
});
document.getElementById('wf-clone').addEventListener('click', () => {
  wfCloneRow.classList.add('visible');
  wfRepo.focus();
});
function wfCloneGo() {
  const repo = wfRepo.value.trim();
  if (!repo) { wfRepo.focus(); return; }
  sendToAgent(`Clone the repository at ${repo} into my project folder, install its dependencies, and start its dev server on a free, open localhost port. When it's running, reply with the exact http://localhost:<port> URL so I can open it here in the Working File.`);
  wfRepo.value = '';
  wfCloneRow.classList.remove('visible');
}
document.getElementById('wf-clone-go').addEventListener('click', wfCloneGo);
wfRepo.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); wfCloneGo(); } });

function createTab(url = '') {
  const tab = { id: nextTabId++, url, title: 'New Tab' };
  tabs.push(tab);
  switchTab(tab.id, true);
  return tab;
}

function closeTab(id) {
  if (tabs.length === 1) return;
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (activeTabId === id) switchTab(tabs[Math.min(idx, tabs.length - 1)].id, true);
  else renderTabs();
}

function switchTab(id, navigate = false) {
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  addressBar.value = (tab.url && tab.url !== 'about:blank') ? tab.url : '';
  // Only navigate when the tab actually has a URL. Navigating blank tabs to
  // about:blank at boot raced (and aborted) the saved-URL restore in main;
  // a blank tab hides the browser view via set-browser-empty anyway.
  if (navigate && tab.url && tab.url !== 'about:blank') {
    ipcRenderer.send('browser-navigate', tab.url);
  }
  renderTabs();
  updateWfEmpty();
}

function renderTabs() {
  tabsContainer.innerHTML = '';
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.title = tab.title;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    el.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    el.appendChild(closeBtn);

    el.addEventListener('click', () => { if (tab.id !== activeTabId) switchTab(tab.id, true); });
    tabsContainer.appendChild(el);
  }
}

createTab('');
document.getElementById('btn-new-tab').addEventListener('click', () => createTab(''));

addressBar.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { ipcRenderer.send('browser-navigate', addressBar.value); addressBar.blur(); }
  if (e.key === 'Escape') addressBar.blur();
});
addressBar.addEventListener('focus', () => addressBar.select());
document.getElementById('btn-reload').addEventListener('click', () => ipcRenderer.send('browser-reload'));

// ── Device emulation dropdown ─────────────────────────────────────
let openEditDevicesModal = null;   // set by the edit-devices modal IIFE
(function initDeviceDropdown() {
  const btn   = document.getElementById('btn-device');
  const label = document.getElementById('btn-device-label');
  if (!btn) return;

  // Built-in presets (CSS-pixel viewport sizes) — mirrors Chrome's list.
  const DEVICE_PRESETS = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone XR', width: 414, height: 896 },
    { name: 'iPhone 12 Pro', width: 390, height: 844 },
    { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
    { name: 'Pixel 7', width: 412, height: 915 },
    { name: 'Samsung Galaxy S8+', width: 360, height: 740 },
    { name: 'Samsung Galaxy S20 Ultra', width: 412, height: 915 },
    { name: 'iPad Mini', width: 768, height: 1024 },
    { name: 'iPad Air', width: 820, height: 1180 },
    { name: 'iPad Pro', width: 1024, height: 1366 },
    { name: 'Surface Pro 7', width: 912, height: 1368 },
    { name: 'Surface Duo', width: 540, height: 720 },
    { name: 'Galaxy Z Fold 5', width: 344, height: 882 },
    { name: 'Asus Zenbook Fold', width: 853, height: 1280 },
    { name: 'Samsung Galaxy A51/71', width: 412, height: 914 },
    { name: 'Nest Hub', width: 1024, height: 600 },
    { name: 'Nest Hub Max', width: 1280, height: 800 },
  ];

  function customDevices() {
    try { return JSON.parse(localStorage.getItem(LS.devices) || '[]'); } catch (_) { return []; }
  }
  function allDevices() { return [...DEVICE_PRESETS, ...customDevices()]; }

  const MIN = 160;

  // active emulation descriptor. `default:true` = clean full-panel browser (no
  // handles); name '' (no default) = Responsive (resizable, with handles); name
  // set = a device preset. Default view is the startup default.
  let active;
  try { active = JSON.parse(localStorage.getItem(LS.deviceActive)); } catch (_) {}
  if (!active || typeof active !== 'object') active = { default: true };

  function persist() { localStorage.setItem(LS.deviceActive, JSON.stringify(active)); }
  function setLabel() {
    label.textContent = active.default ? 'Default view' : (active.name || 'Responsive');
    btn.classList.toggle('emulating', !active.default);
  }
  function sendActive() {
    if (active.default)   ipcRenderer.send('set-device', { default: true });
    else if (active.name) ipcRenderer.send('set-device', { name: active.name, width: active.width, height: active.height });
    else if (active.fit)  ipcRenderer.send('set-device', { responsive: true });
    else                  ipcRenderer.send('set-device', { name: '', width: active.width, height: active.height });
  }
  setLabel();

  // Estimate the native menu's width from its longest label so we can
  // right-align its right edge with the button (native menus position from
  // their top-left, with no width API). +60 ≈ check gutter + side padding.
  function menuWidth(devices) {
    const labels = ['Default view', 'Responsive', 'Edit…', ...devices.map(d => d.name)];
    const ctx2 = (menuWidth._c || (menuWidth._c = document.createElement('canvas'))).getContext('2d');
    ctx2.font = '12px "Segoe UI", system-ui, sans-serif';
    let max = 0;
    for (const l of labels) max = Math.max(max, ctx2.measureText(l).width);
    return Math.ceil(max) + 60;
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    const devices = allDevices();
    ipcRenderer.send('show-device-menu', {
      x: Math.round(r.right - menuWidth(devices)), y: Math.round(r.bottom + 2),
      devices, activeName: active.name, defaultView: !!active.default,
    });
  });

  // Native-menu selection. Reconstruct the descriptor.
  ipcRenderer.on('device-changed', (_, { name, default: isDefault }) => {
    if (isDefault) {
      active = { default: true };
    } else if (name) {
      const d = allDevices().find(x => x.name === name);
      active = d ? { name, width: d.width, height: d.height, fit: false } : { default: true };
    } else {
      active = { name: '', fit: true };
    }
    persist(); setLabel();
  });

  // Edit modal saved — re-apply (the active custom device may have changed/gone).
  window.__reapplyActiveDevice = () => {
    if (active.name && !allDevices().find(d => d.name === active.name)) {
      active = { name: '', fit: true }; persist(); setLabel();
    }
    sendActive();
  };

  // ── Resize handles + ghost drag ─────────────────────────────────
  const layer = document.getElementById('device-resize-layer');
  const ghost = document.getElementById('device-ghost');
  const ghostDims = document.getElementById('device-ghost-dims');
  const hr = document.getElementById('device-handle-r');
  const hb = document.getElementById('device-handle-b');
  const hc = document.getElementById('device-handle-c');
  const HANDLE = 14;
  let bounds = null, drag = null;

  function placeHandles() {
    if (!bounds) { layer.classList.remove('active'); return; }
    layer.classList.add('active');
    const { x, y, width, height } = bounds;
    hr.style.cssText = `left:${x + width}px;top:${y}px;width:${HANDLE}px;height:${height}px`;
    hb.style.cssText = `left:${x}px;top:${y + height}px;width:${width}px;height:${HANDLE}px`;
    hc.style.cssText = `left:${x + width}px;top:${y + height}px;width:${HANDLE}px;height:${HANDLE}px`;
  }
  ipcRenderer.on('device-view-bounds', (_, b) => { bounds = b; if (!drag) placeHandles(); });

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function showGhost(w, h) {
    const gx = Math.round(drag.panelX + (drag.panelW - w) / 2);   // centered horizontally
    ghost.style.cssText = `left:${gx}px;top:${drag.panelY}px;width:${w}px;height:${h}px;display:block`;
    ghostDims.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  }
  function onMove(e) {
    if (!drag) return;
    let w = drag.w, h = drag.h;
    // Centered → width resizes symmetrically (both edges move), so the right
    // handle still tracks the cursor 1:1.
    if (drag.axis !== 'y') w = clamp(drag.w + 2 * (e.clientX - drag.sx), MIN, drag.maxW);
    if (drag.axis !== 'x') h = clamp(drag.h + (e.clientY - drag.sy), MIN, drag.maxH);
    drag.cw = w; drag.ch = h;
    showGhost(w, h);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    document.body.style.cursor = '';
    const w = Math.round(drag.cw ?? drag.w), h = Math.round(drag.ch ?? drag.h);
    ghost.style.display = 'none';
    ipcRenderer.send('device-resize-end', { width: w, height: h });
    active = { name: '', width: w, height: h, fit: false };
    persist(); setLabel();
    drag = null;
  }
  function startDrag(axis, e) {
    if (!bounds) return;
    e.preventDefault();
    drag = { axis, sx: e.clientX, sy: e.clientY, w: bounds.width, h: bounds.height,
             panelX: bounds.panelX, panelY: bounds.panelY, panelW: bounds.panelW,
             maxW: bounds.panelW - HANDLE * 2, maxH: bounds.panelH - HANDLE };
    ipcRenderer.send('device-resize-start');   // main hides the view
    document.body.style.cursor = axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : 'nwse-resize';
    showGhost(drag.w, drag.h);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }
  hr.addEventListener('mousedown', e => startDrag('x', e));
  hb.addEventListener('mousedown', e => startDrag('y', e));
  hc.addEventListener('mousedown', e => startDrag('xy', e));

  // Apply the persisted emulation on startup (once the browser view exists).
  setTimeout(sendActive, 300);
})();

// ── Custom Devices modal ──────────────────────────────────────────
(function initDevicesModal() {
  const modal  = document.getElementById('devices-modal');
  const listEl = document.getElementById('devices-list');
  const nameIn = document.getElementById('dev-add-name');
  const wIn    = document.getElementById('dev-add-w');
  const hIn    = document.getElementById('dev-add-h');
  const addBtn = document.getElementById('dev-add-btn');
  const saveBtn   = document.getElementById('devices-save');
  const cancelBtn = document.getElementById('devices-cancel');
  if (!modal) return;

  let draft = [];

  function render() {
    listEl.innerHTML = '';
    if (!draft.length) {
      listEl.innerHTML = '<div class="dev-empty">No custom devices yet.</div>';
      return;
    }
    draft.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'dev-row';
      row.innerHTML = `<span class="dev-row-name"></span><span class="dev-row-dims">${d.width} × ${d.height}</span><button class="dev-row-del" title="Remove">${trashIcon(14)}</button>`;
      row.querySelector('.dev-row-name').textContent = d.name;
      row.querySelector('.dev-row-del').addEventListener('click', () => { draft.splice(i, 1); render(); });
      listEl.appendChild(row);
    });
  }

  function addFromInputs() {
    const name = nameIn.value.trim();
    const w = parseInt(wIn.value, 10), h = parseInt(hIn.value, 10);
    if (!name || !(w > 0) || !(h > 0)) return;
    draft.push({ name, width: w, height: h, custom: true });
    nameIn.value = ''; wIn.value = ''; hIn.value = '';
    nameIn.focus();
    render();
  }
  addBtn.addEventListener('click', addFromInputs);
  [nameIn, wIn, hIn].forEach(el => el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); addFromInputs(); }
  }));

  const ctl = wireModal(modal);

  saveBtn.addEventListener('click', () => {
    localStorage.setItem(LS.devices, JSON.stringify(draft));
    window.__reapplyActiveDevice?.();   // active device may have been edited/removed
    ctl.close();
  });
  cancelBtn.addEventListener('click', ctl.close);

  openEditDevicesModal = function() {
    try { draft = JSON.parse(localStorage.getItem(LS.devices) || '[]'); } catch (_) { draft = []; }
    nameIn.value = ''; wIn.value = ''; hIn.value = '';
    render();
    ctl.open();
  };
})();

ipcRenderer.on('browser-url-changed', (_, url) => {
  addressBar.value = (url && url !== 'about:blank') ? url : '';
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.url = url;
  updateWfEmpty();
});

ipcRenderer.on('tab-title-updated', (_, title) => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && title) { tab.title = title; renderTabs(); }
});

const devToolsBtn = document.getElementById('btn-devtools');
devToolsBtn.addEventListener('click', () => ipcRenderer.send('browser-toggle-devtools'));
ipcRenderer.on('devtools-opened', () => devToolsBtn.classList.add('active'));
ipcRenderer.on('devtools-closed', () => devToolsBtn.classList.remove('active'));

// ── Pick mode ─────────────────────────────────────────────────────
let pickMode = null;
let lastDrawMode = 'box';   // remembers box vs lasso for the panel's "New Selection" button

function applyPickCursor(mode) {
  document.documentElement.setAttribute('data-pick', mode || '');
}

function setPickMode(mode) {
  if (pickMode === mode) {
    // Toggle off: also dismiss the armed overlay in the page, not just the UI
    ipcRenderer.send('pick-cancel');
    clearPickMode();
    return;
  }
  pickMode = mode;
  if (mode === 'box' || mode === 'lasso') lastDrawMode = mode;
  applyPickCursor(mode);
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-pick-${mode}`).classList.add('active');
  ipcRenderer.send('pick-start', mode);
}

document.getElementById('btn-pick-box').addEventListener('click',   () => setPickMode('box'));
document.getElementById('btn-pick-lasso').addEventListener('click', () => setPickMode('lasso'));
document.getElementById('btn-pick-aidev').addEventListener('click', () => setPickMode('aidev'));
document.getElementById('btn-screenshot').addEventListener('click', () => {
  if (pickMode === 'screenshot') { ipcRenderer.send('pick-cancel'); clearPickMode(); return; }
  clearPickMode();
  pickMode = 'screenshot';
  applyPickCursor('screenshot');
  document.getElementById('btn-screenshot').classList.add('active');
  ipcRenderer.send('pick-screenshot');
});
document.getElementById('btn-pick-resize').addEventListener('click', () => {
  if (pickMode === 'resize') { ipcRenderer.send('pick-cancel'); clearPickMode(); return; }
  clearPickMode();
  pickMode = 'resize';
  applyPickCursor('resize');
  document.getElementById('btn-pick-resize').classList.add('active');
  ipcRenderer.send('pick-resize');
});

document.getElementById('btn-draw').addEventListener('click', () => {
  if (pickMode === 'draw') { clearPickMode(); ipcRenderer.send('draw-cancel'); return; }
  clearPickMode();
  pickMode = 'draw';
  applyPickCursor('draw');
  document.getElementById('btn-draw').classList.add('active');
  ipcRenderer.send('pick-draw');
});

document.getElementById('btn-pick-eyedropper').addEventListener('click', () => {
  if (pickMode === 'eyedropper') { ipcRenderer.send('pick-cancel'); clearPickMode(); return; }
  clearPickMode();
  pickMode = 'eyedropper';
  applyPickCursor('eyedropper');
  document.getElementById('btn-pick-eyedropper').classList.add('active');
  ipcRenderer.send('pick-eyedropper');
});

document.getElementById('btn-pick-a11y').addEventListener('click', () => {
  if (pickMode === 'a11y') { ipcRenderer.send('pick-cancel'); clearPickMode(); return; }
  clearPickMode();
  pickMode = 'a11y';
  applyPickCursor('a11y');
  document.getElementById('btn-pick-a11y').classList.add('active');
  ipcRenderer.send('pick-a11y');
});

function clearPickMode() {
  pickMode = null;
  applyPickCursor(null);
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
}

// ── Mirror toolbar tools into the browser-view context menu ──────────
// The context menu is native (it composites over the WebContentsView), so it
// needs raster icons — rasterize each toolbar SVG to a PNG the menu can show.
(function registerBrowserTools() {
  const TOOLS = PAGE_TOOLS.filter(t => t.menu).map(t => ({ id: t.id, key: t.key, label: t.label, accel: accelOf(t) }));

  function svgToPng(svgEl, px, color) {
    return new Promise((resolve) => {
      const clone = svgEl.cloneNode(true);
      clone.setAttribute('width', px); clone.setAttribute('height', px);
      clone.setAttribute('color', color); clone.style.color = color;
      const xml = new XMLSerializer().serializeToString(clone);
      const src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = px; c.height = px;
        c.getContext('2d').drawImage(img, 0, 0, px, px);
        try { resolve(c.toDataURL('image/png')); } catch (_) { resolve(''); }
      };
      img.onerror = () => resolve('');
      img.src = src;
    });
  }

  Promise.all(TOOLS.map(async (t) => {
    const svg = document.querySelector(`#${t.id} svg`);
    const icon = svg ? await svgToPng(svg, 16, '#c8ccd4') : '';
    return { key: t.key, label: t.label, accel: t.accel, icon };
  })).then((tools) => ipcRenderer.send('register-browser-tools', tools));
})();

ipcRenderer.on('pick-cancelled', () => clearPickMode());
ipcRenderer.on('pick-complete',  () => clearPickMode());

// ── Box/Lasso element panel (overtakes the chat column) ──────────
// Faithful port of the in-page popup drawers: filter chips, per-element CSS
// drawers (expand/search/checkbox), inline value editing + color picker that
// live-edit the actual page element (proxied via 'pick-panel-style').
(function initPickPanel() {
  const panel       = document.getElementById('pick-panel');
  const titleEl     = document.getElementById('pick-panel-title');
  const listEl      = document.getElementById('pick-panel-list');
  const filterSelect = document.getElementById('pick-panel-filter-select');
  const filterInput = document.getElementById('pick-panel-filter');
  const textarea    = document.getElementById('pick-panel-textarea');
  const sendBtn     = document.getElementById('pick-panel-send');
  const cancelBtn   = document.getElementById('pick-panel-cancel-btn');
  if (!panel) return;

  let rows = [];          // [{ item, removed, expanded, checked:Set, mods:{} }]
  let activeChip = null;
  let hovered = null;     // index of the drawer currently hovered

  // Highlight on the page = every open drawer + the hovered one.
  function highlightSet() {
    const s = new Set();
    rows.forEach((r, i) => { if (!r.removed && r.expanded) s.add(i); });
    if (hovered != null && rows[hovered] && !rows[hovered].removed) s.add(hovered);
    return [...s];
  }
  function pushHighlight() { ipcRenderer.send('pick-panel-update', { active: highlightSet() }); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function activeIndices() { return rows.map((r, i) => (r.removed ? -1 : i)).filter(i => i >= 0); }
  function applyStyle(i, prop, value) { ipcRenderer.send('pick-panel-style', { i, prop, value }); }

  // ── one CSS property row ──────────────────────────────────────
  // ── property metadata (Method 2 sections + Method 3 typed controls) ─
  const SECTIONS = [
    ['Layout',     ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap', 'grid-template-columns', 'grid-template-rows']],
    ['Sizing',     ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']],
    ['Spacing',    ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']],
    ['Position',   ['position', 'top', 'right', 'bottom', 'left', 'z-index']],
    ['Typography', ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'color']],
    ['Appearance', ['background-color', 'background-image', 'background-size', 'border-radius', 'border-top-width', 'border-top-style', 'border-top-color', 'box-shadow', 'opacity', 'overflow', 'cursor', 'transform']],
  ];
  const SECTION_OF = {}; SECTIONS.forEach(([n, ps]) => ps.forEach(p => { SECTION_OF[p] = n; }));
  const SECTION_ORDER = SECTIONS.map(s => s[0]).concat('Other');
  const sectionOf = p => SECTION_OF[p] || 'Other';
  const ENUMS = {
    'display': ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'none', 'contents'],
    'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
    'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
    'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
    'align-items': ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
    'align-self': ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
    'position': ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
    'text-align': ['left', 'center', 'right', 'justify', 'start', 'end'],
    'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
    'border-top-style': ['none', 'solid', 'dashed', 'dotted', 'double'],
    'background-size': ['auto', 'cover', 'contain'],
    'overflow': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
    'cursor': ['auto', 'default', 'pointer', 'text', 'move', 'grab', 'crosshair', 'not-allowed', 'wait', 'help'],
  };
  const COLOR_PROPS = new Set(['color', 'background-color', 'border-top-color']);
  const UNITLESS = new Set(['opacity', 'z-index']);
  const UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh', 'auto'];
  const LABELS = {
    'background-color': 'Background', 'background-image': 'Bg image', 'background-size': 'Bg size',
    'border-radius': 'Radius', 'border-top-width': 'Border width', 'border-top-style': 'Border style', 'border-top-color': 'Border color',
    'font-family': 'Font', 'font-size': 'Size', 'font-weight': 'Weight', 'line-height': 'Line height', 'letter-spacing': 'Letter spacing',
    'text-align': 'Align', 'text-transform': 'Transform', 'flex-direction': 'Direction', 'flex-wrap': 'Wrap',
    'justify-content': 'Justify', 'align-items': 'Align items', 'align-self': 'Align self',
    'grid-template-columns': 'Grid cols', 'grid-template-rows': 'Grid rows', 'z-index': 'Z-index', 'box-shadow': 'Shadow',
  };
  const labelFor = p => LABELS[p] || p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  function parseLen(v) {
    const m = /^(-?\d*\.?\d+)\s*(px|%|em|rem|vw|vh|vmin|vmax|pt|ch|fr|deg)?$/.exec(String(v).trim());
    return m ? { num: m[1], unit: m[2] || '' } : null;
  }
  function controlType(prop, val) {
    if (COLOR_PROPS.has(prop) || /(^|-)color$/.test(prop)) return 'color';
    if (ENUMS[prop]) return 'enum';
    if (parseLen(val)) return 'length';
    return 'text';
  }

  // Drag-scrubber handle for numeric fields (drag left ↓ / right ↑).
  const SLIDE_ICON = '<svg width="13" height="13" viewBox="0 0 18 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12.7549 5.50488C13.0283 5.23151 13.4718 5.23151 13.7451 5.50488L16.7451 8.50488C17.0185 8.77824 17.0185 9.22174 16.7451 9.49511L13.7451 12.4951C13.4718 12.7685 13.0283 12.7685 12.7549 12.4951C12.4815 12.2217 12.4815 11.7782 12.7549 11.5049L15.2598 8.99999L12.7549 6.49511C12.4815 6.22174 12.4815 5.77824 12.7549 5.50488Z"/><path d="M4.25489 5.50488C4.52826 5.23151 4.97176 5.23151 5.24513 5.50488C5.51849 5.77824 5.51849 6.22174 5.24513 6.49511L2.74024 8.99999L5.24513 11.5049C5.51849 11.7782 5.51849 12.2217 5.24513 12.4951C4.97176 12.7685 4.52826 12.7685 4.25489 12.4951L1.25489 9.49511C0.981524 9.22174 0.981524 8.77824 1.25489 8.50488L4.25489 5.50488Z"/><path d="M16.25 8.29979C16.6366 8.29979 16.9502 8.61339 16.9502 8.99998C16.9502 9.38658 16.6366 9.70018 16.25 9.70018H1.75C1.3634 9.70018 1.0498 9.38658 1.0498 8.99998C1.0498 8.61339 1.3634 8.29979 1.75 8.29979H16.25Z"/></svg>';

  // Route a native <select> through the app's shared custom dropdown, compactly.
  function compactSelect(sel, isUnit) {
    enhanceSelect(sel);
    const wrap = sel.closest('.ct-select');
    if (wrap) { wrap.classList.add('pp-ct'); if (isUnit) wrap.classList.add('pp-ct-unit'); }
  }

  // Total selected properties across all (kept) elements → Send button label.
  function updateSendCount() {
    const n = rows.filter(r => !r.removed).reduce((a, r) => a + r.checked.size, 0);
    sendBtn.textContent = n ? `Send (${n})` : 'Send';
    fieldBodies.forEach(fb => { if (fb.count) fb.count.textContent = `${fb.row.checked.size} Selected`; });
  }

  // ── one property as a field card with a typed control ─────────
  function buildField(row, i, p) {
    const cur = row.mods[p.name] !== undefined ? row.mods[p.name] : p.value;
    const field = el('div', 'pp-field');
    field.dataset.name = p.name;
    field.dataset.val  = cur;
    if (row.checked.has(p.name)) field.classList.add('selected');
    if (row.mods[p.name] !== undefined) field.classList.add('modified');

    const sel = el('button', 'pp-field-sel'); sel.title = 'Include in message';
    sel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (row.checked.has(p.name)) { row.checked.delete(p.name); field.classList.remove('selected'); }
      else { row.checked.add(p.name); field.classList.add('selected'); }
      updateSendCount();
    });
    const label = el('span', 'pp-field-label', labelFor(p.name)); label.title = p.name;
    const ctrl  = el('div', 'pp-field-ctrl');

    function commit(v) {
      row.mods[p.name] = v;
      row.checked.add(p.name);
      applyStyle(i, p.name, v);
      field.dataset.val = v;
      field.classList.add('selected', 'modified');
      updateSendCount();
    }

    const type = controlType(p.name, cur);
    if      (type === 'color')  ctrlColor(ctrl, field, cur, commit);
    else if (type === 'enum')   ctrlEnum(ctrl, p.name, cur, commit);
    else if (type === 'length') ctrlLength(ctrl, p.name, cur, commit);
    else                        ctrlText(ctrl, cur, commit);

    // Image properties: a folder button to pick a local image — its path is
    // written as url('…') so it rides along to the agent (which can open it).
    if (/image/.test(p.name)) {
      const pick = el('button', 'pp-img-pick'); pick.innerHTML = FOLDER_GLYPH; pick.title = 'Choose image…';
      pick.addEventListener('click', async (e) => {
        e.stopPropagation();
        const file = await ipcRenderer.invoke('pick-image-file');
        if (!file) return;
        const v = `url('${file}')`;
        const input = ctrl.querySelector('input');
        if (input) input.value = v;
        commit(v);
      });
      ctrl.appendChild(pick);
    }

    field.append(sel, label, ctrl);
    return field;
  }

  function ctrlColor(ctrl, field, cur, commit) {
    const sw = el('span', 'pp-swatch'); sw.style.background = (cur === 'none' || !cur) ? 'transparent' : cur;
    const hex = el('input', 'pp-ctrl-input pp-color-hex'); hex.type = 'text'; hex.value = cur; hex.spellcheck = false;
    ctrl.append(sw, hex);
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      colorPicker.open(sw, field.dataset.val, (h) => { hex.value = h; sw.style.background = h; commit(h); });
    });
    hex.addEventListener('click', e => e.stopPropagation());
    hex.addEventListener('keydown', e => e.stopPropagation());
    hex.addEventListener('input', () => { sw.style.background = hex.value; commit(hex.value); });
  }
  function ctrlEnum(ctrl, prop, cur, commit) {
    const sel = el('select', 'pp-select');
    const opts = ENUMS[prop].slice();
    if (cur && !opts.includes(cur)) opts.unshift(cur);
    opts.forEach(o => { const op = el('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
    sel.value = cur;
    sel.addEventListener('change', () => commit(sel.value));
    ctrl.appendChild(sel);
    compactSelect(sel, false);
  }
  function ctrlLength(ctrl, prop, cur, commit) {
    const parsed = parseLen(cur);
    const num = el('input', 'pp-ctrl-input pp-num'); num.type = 'text'; num.value = parsed ? parsed.num : cur;
    // Slider: drag the knob to scrub the value (relative; Shift ±10, Alt ±0.1).
    const slider = el('div', 'pp-slider'); slider.title = 'Drag to adjust';
    const knob = el('div', 'pp-slider-knob');
    slider.appendChild(knob);
    knob.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      knob.style.transform = '';   // re-centre on the current value as you grab it
      const startX = e.clientX, V = parseFloat(num.value) || 0;
      const half = slider.clientWidth / 2;
      document.body.style.cursor = 'ew-resize';
      function onMove(ev) {
        const off = Math.max(-half, Math.min(half, ev.clientX - startX));
        num.value = Math.round(V * (1 + off / half) * 1000) / 1000;   // left → 0, centre → V, right → 2×V
        knob.style.transform = `translate(calc(-50% + ${off}px), -50%)`;
        apply();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.body.style.cursor = '';
        // knob stays where it was released
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });
    // Drag-scrub handle inside the input (right side) — same behaviour as before.
    const numWrap = el('div', 'pp-num-wrap');
    const scrub = el('span', 'pp-scrub'); scrub.innerHTML = SLIDE_ICON; scrub.title = 'Drag to adjust';
    scrub.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startNum = parseFloat(num.value) || 0;
      document.body.style.cursor = 'ew-resize';
      function onMove(ev) {
        const step = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        num.value = Math.round((startNum + Math.round((ev.clientX - startX) / 2) * step) * 1000) / 1000;
        apply();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.body.style.cursor = '';
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });
    numWrap.append(num, scrub);
    ctrl.append(slider, numWrap);
    let unitSel = null;
    if (!UNITLESS.has(prop)) {
      unitSel = el('select', 'pp-unit');
      const units = ['', ...UNITS];                 // '' = unitless (e.g. line-height)
      const u = parsed ? parsed.unit : '';
      if (u && !units.includes(u)) units.push(u);
      units.forEach(x => { const op = el('option'); op.value = x; op.textContent = x || '—'; unitSel.appendChild(op); });
      unitSel.value = u;
      ctrl.appendChild(unitSel);
    }
    const apply = () => {
      const n = num.value.trim();
      const u = unitSel ? unitSel.value : '';
      commit(u === 'auto' ? 'auto' : (n + (u || '')));
    };
    num.addEventListener('click', e => e.stopPropagation());
    num.addEventListener('input', apply);
    num.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const n = parseFloat(num.value); if (isNaN(n)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        num.value = Math.round((n + (e.key === 'ArrowUp' ? 1 : -1) * step) * 1000) / 1000;
        apply();
      }
    });
    if (unitSel) { unitSel.addEventListener('change', apply); compactSelect(unitSel, true); }
  }
  function ctrlText(ctrl, cur, commit) {
    const inp = el('input', 'pp-ctrl-input pp-text'); inp.type = 'text'; inp.value = cur; inp.spellcheck = false;
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('keydown', e => e.stopPropagation());
    inp.addEventListener('input', () => commit(inp.value));
    ctrl.appendChild(inp);
  }

  // Build a drawer's fields lazily (on first expand) — avoids enhancing the
  // dropdowns of every collapsed element up front.
  let fieldBodies = [];   // [{ row, i, body, caret }]
  function buildBody(row, i, body) {
    if (body.dataset.built) return;
    body.dataset.built = '1';
    const props = row.item.cssProps || [];
    if (!props.length) { body.appendChild(el('div', 'pp-no-css', 'no CSS properties')); return; }
    const bySection = {};
    props.forEach(p => { const s = sectionOf(p.name); (bySection[s] = bySection[s] || []).push(p); });
    SECTION_ORDER.forEach(secName => {
      const list = bySection[secName]; if (!list) return;
      const sec = el('div', 'pp-section'); sec.dataset.section = secName;
      sec.appendChild(el('div', 'pp-section-title', secName));
      list.forEach(p => sec.appendChild(buildField(row, i, p)));
      body.appendChild(sec);
    });
  }

  // ── full drawer list ──────────────────────────────────────────
  function render() {
    listEl.innerHTML = '';
    fieldBodies = [];
    rows.forEach((row, i) => {
      if (row.removed) return;
      const drawer = el('div', 'pp-drawer');

      const head  = el('div', 'pp-drawer-head');
      const caret = el('span', 'pp-caret' + (row.expanded ? ' open' : ''));   // chevron via CSS mask (icons/chevron.svg)
      const name  = el('span', 'pp-el-name');
      if (row.item.descriptor) name.appendChild(el('span', 'pp-el-desc', `${row.item.descriptor}: `));
      name.appendChild(document.createTextNode(row.item.label));
      name.title  = row.item.cssSelector || row.item.label;
      const count = el('span', 'pp-el-count', `${row.checked.size} Selected`);
      const x     = el('button', 'pp-el-x', '✕'); x.title = 'Remove';
      head.append(caret, name, count, x);
      drawer.appendChild(head);

      const body  = el('div', 'pp-drawer-body');
      body.style.display = row.expanded ? '' : 'none';
      if (row.expanded) buildBody(row, i, body);
      drawer.appendChild(body);
      fieldBodies.push({ row, i, body, caret, count });

      head.addEventListener('click', (e) => {
        if (e.target === x) return;
        row.expanded = !row.expanded;
        if (row.expanded) buildBody(row, i, body);
        body.style.display = row.expanded ? '' : 'none';
        caret.classList.toggle('open', row.expanded);
        pushHighlight();
      });
      drawer.addEventListener('mouseenter', () => { hovered = i; pushHighlight(); });
      drawer.addEventListener('mouseleave', () => { if (hovered === i) hovered = null; pushHighlight(); });
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        row.removed = true;
        if (hovered === i) hovered = null;
        if (!activeIndices().length) { cancel(); return; }
        pushHighlight();
        render();
      });
      listEl.appendChild(drawer);
    });
    applyFilter();
    updateSendCount();
  }

  // ── filtering: chip category (AND) + single free-text box ─────
  function applyFilter() {
    const kw = activeChip;
    const q  = filterInput.value.trim().toLowerCase();
    if (kw || q) {   // build + expand every drawer so matches are visible/searchable
      fieldBodies.forEach(fb => { fb.row.expanded = true; buildBody(fb.row, fb.i, fb.body); fb.body.style.display = ''; fb.caret.classList.add('open'); });
    }
    listEl.querySelectorAll('.pp-field').forEach(f => {
      const okChip = !kw || f.dataset.name.includes(kw);
      const okText = !q  || f.dataset.name.includes(q) || f.dataset.val.toLowerCase().includes(q);
      f.style.display = (okChip && okText) ? '' : 'none';
    });
    listEl.querySelectorAll('.pp-section').forEach(sec => {
      const any = [...sec.querySelectorAll('.pp-field')].some(f => f.style.display !== 'none');
      sec.style.display = any ? '' : 'none';
    });
  }
  if (filterSelect) {
    enhanceSelect(filterSelect);
    filterSelect.closest('.ct-select')?.classList.add('pp-filter-ct');
    filterSelect.addEventListener('change', () => { activeChip = filterSelect.value || null; applyFilter(); });
  }
  filterInput.addEventListener('input', applyFilter);

  // ── color picker (lazy iro, shared singleton) ─────────────────
  const colorPicker = (function () {
    let cpEl = null, cpIro = null, applyFn = null, swatchEl = null;
    let syncing = false, mode = 'hex', inputs = null, built = false;

    function ensureIro(cb) {
      if (window.iro) { cb(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@jaames/iro@5/dist/iro.min.js';
      s.onload = cb; document.head.appendChild(s);
    }
    function sync(color) {
      if (!inputs) return;
      syncing = true;
      inputs.hex.value = color.hexString;
      const rgb = color.rgb; inputs.r.value = rgb.r; inputs.g.value = rgb.g; inputs.b.value = rgb.b;
      const hsl = color.hsl; inputs.h.value = Math.round(hsl.h); inputs.s.value = Math.round(hsl.s); inputs.l.value = Math.round(hsl.l);
      syncing = false;
    }
    function setMode(m) {
      mode = m;
      cpEl.querySelectorAll('.pp-cp-panel').forEach(p => p.style.display = p.dataset.m === m ? '' : 'none');
      cpEl.querySelectorAll('.pp-cp-mode').forEach(b => b.classList.toggle('active', b.dataset.m === m));
    }
    function build() {
      built = true;
      cpEl = el('div'); cpEl.id = 'pp-colorpicker';
      cpEl.innerHTML =
        '<div class="pp-cp-iro"></div>' +
        '<div class="pp-cp-modes">' +
          '<button class="pp-cp-mode active" data-m="hex">HEX</button>' +
          '<button class="pp-cp-mode" data-m="rgb">RGB</button>' +
          '<button class="pp-cp-mode" data-m="hsl">HSL</button>' +
        '</div>' +
        '<div class="pp-cp-panel" data-m="hex" style="margin-top:7px"><input class="pp-cp-hex" type="text"/></div>' +
        '<div class="pp-cp-panel" data-m="rgb" style="margin-top:7px;display:none"><div class="pp-cp-fields"><span>R</span><input data-c="r" type="number" min="0" max="255"/><span>G</span><input data-c="g" type="number" min="0" max="255"/><span>B</span><input data-c="b" type="number" min="0" max="255"/></div></div>' +
        '<div class="pp-cp-panel" data-m="hsl" style="margin-top:7px;display:none"><div class="pp-cp-fields"><span>H</span><input data-c="h" type="number" min="0" max="360"/><span>S</span><input data-c="s" type="number" min="0" max="100"/><span>L</span><input data-c="l" type="number" min="0" max="100"/></div></div>';
      document.body.appendChild(cpEl);
      cpEl.querySelectorAll('.pp-cp-mode').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); setMode(b.dataset.m); }));
      inputs = {
        hex: cpEl.querySelector('.pp-cp-hex'),
        r: cpEl.querySelector('[data-c=r]'), g: cpEl.querySelector('[data-c=g]'), b: cpEl.querySelector('[data-c=b]'),
        h: cpEl.querySelector('[data-c=h]'), s: cpEl.querySelector('[data-c=s]'), l: cpEl.querySelector('[data-c=l]'),
      };
      const wire = (inputEl, setter) => inputEl.addEventListener('input', () => {
        if (!cpIro || syncing) return;
        syncing = true; try { setter(inputEl.value); } catch (_) {} syncing = false;
        sync(cpIro.color); push(cpIro.color.hexString);
      });
      wire(inputs.hex, v => { cpIro.color.hexString = v; });
      wire(inputs.r, v => { const c = cpIro.color.rgb; c.r = +v; cpIro.color.rgb = c; });
      wire(inputs.g, v => { const c = cpIro.color.rgb; c.g = +v; cpIro.color.rgb = c; });
      wire(inputs.b, v => { const c = cpIro.color.rgb; c.b = +v; cpIro.color.rgb = c; });
      wire(inputs.h, v => { const c = cpIro.color.hsl; c.h = +v; cpIro.color.hsl = c; });
      wire(inputs.s, v => { const c = cpIro.color.hsl; c.s = +v; cpIro.color.hsl = c; });
      wire(inputs.l, v => { const c = cpIro.color.hsl; c.l = +v; cpIro.color.hsl = c; });
    }
    function push(hex) {
      if (swatchEl) swatchEl.style.background = hex;
      if (applyFn) applyFn(hex);
    }
    function onOutside(e) {
      if (cpEl && !cpEl.contains(e.target) && e.target !== swatchEl) hide();
    }
    function hide() {
      if (cpEl) cpEl.style.display = 'none';
      if (cpIro) { try { cpIro.off('color:change'); } catch (_) {} }
      document.removeEventListener('mousedown', onOutside, true);
    }
    function open(swatch, value, fn) {
      if (!built) build();
      swatchEl = swatch; applyFn = fn;
      const rect = swatch.getBoundingClientRect();
      const pw = 248, ph = 320;
      let left = rect.right + 10;
      if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 10);
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - ph - 10));
      cpEl.style.left = left + 'px'; cpEl.style.top = top + 'px'; cpEl.style.display = 'block';
      setMode(mode);
      setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

      const attach = () => cpIro.on('color:change', (color) => { if (syncing) return; sync(color); push(color.hexString); });
      if (cpIro) {
        try { cpIro.off('color:change'); } catch (_) {}
        try { cpIro.color.set(value || '#ffffff'); } catch (_) {}
        attach(); sync(cpIro.color);
        return;
      }
      ensureIro(() => {
        const mount = cpEl.querySelector('.pp-cp-iro'); mount.innerHTML = '';
        try {
          cpIro = new iro.ColorPicker(mount, {
            width: 200, color: value || '#ffffff',
            layout: [{ component: iro.ui.Box }, { component: iro.ui.Slider, options: { sliderType: 'hue' } }],
          });
        } catch (_) { return; }
        attach(); sync(cpIro.color);
      });
    }
    return { open, hide };
  })();

  // ── open / close / send / cancel ──────────────────────────────
  function open(items, tool) {
    clearPickMode();
    if (tool) titleEl.textContent = tool;
    rows = items.map(item => ({ item, removed: false, expanded: items.length === 1, checked: new Set(), mods: {} }));   // single selection → open by default
    activeChip = null;
    hovered = null;
    if (filterSelect) filterSelect.value = '';   // reset to "Filter: All"
    filterInput.value = '';
    textarea.value = '';
    render();
    pushHighlight();         // nothing highlighted until hover/open
    panel.hidden = false;
    document.getElementById('toolbar')?.classList.add('hidden-by-pick');   // hide the floating tool palette while the menu is open
    setTimeout(() => textarea.focus(), 0);
  }
  function close() {
    colorPicker.hide();
    panel.hidden = true;
    document.getElementById('toolbar')?.classList.remove('hidden-by-pick');
    hovered = null;
    rows = []; listEl.innerHTML = ''; textarea.value = '';
  }
  function resolvedItems() {
    return rows.filter(r => !r.removed).map(r => {
      const it = r.item;
      const selectedCSS = (it.cssProps || []).filter(p => r.checked.has(p.name)).map(p => {
        const nv = r.mods[p.name];
        return nv !== undefined ? `${p.name}: ${nv}  /* was: ${p.value} */` : `${p.name}: ${p.value}`;
      });
      return { label: it.label, cssSelector: it.cssSelector, reactComponent: it.reactComponent, tag: it.tag, debugSource: it.debugSource, selectedCSS };
    });
  }
  function send() {
    ipcRenderer.send('pick-panel-send', { instruction: textarea.value.trim(), items: resolvedItems() });
    close();
  }
  function cancel() {
    ipcRenderer.send('pick-panel-cancel');
    close();
  }

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancel);
  // New Selection: re-arm the same draw tool; completing it reopens the panel with the new items.
  document.getElementById('pick-panel-new')?.addEventListener('click', () => setPickMode(lastDrawMode));
  // Custom resize handle (upper-right of the input): drag to set the textarea height (up → taller).
  const resizeHandle = document.getElementById('pick-panel-resize');
  if (resizeHandle) {
    let startY = 0, startH = 0;
    const onMove = (e) => {
      const max = Math.round(window.innerHeight * 0.7);
      textarea.style.height = Math.max(72, Math.min(startH + (startY - e.clientY), max)) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY; startH = textarea.getBoundingClientRect().height;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none';
    });
  }
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && document.activeElement !== textarea) { e.preventDefault(); cancel(); }
  });

  ipcRenderer.on('pick-panel-open', (_, { items, tool }) => open(items || [], tool));
})();

// ── Resize tool panel (overtakes the chat column) ────────────────
// The handles stay live on the page; this panel shows the element, live W×H
// (polled from main), an instructions box, and Reset / Cancel / Send.
(function initResizePanel() {
  const panel    = document.getElementById('resize-panel');
  const titleEl  = document.getElementById('resize-panel-title');
  const elEl     = document.getElementById('resize-panel-el');
  const wEl       = document.getElementById('resize-w');
  const hEl       = document.getElementById('resize-h');
  const wSlider   = document.getElementById('resize-w-slider');
  const hSlider   = document.getElementById('resize-h-slider');
  const textarea  = document.getElementById('resize-textarea');
  const resetBtn  = document.getElementById('resize-reset');
  const cancelBtn = document.getElementById('resize-cancel');
  const sendBtn   = document.getElementById('resize-send');
  if (!panel) return;

  let sliding = null;   // 'w' | 'h' while the user drags a slider (don't let polling fight it)

  function setText(el, nv, ov) { const d = nv - ov; el.textContent = nv + (d ? `  (${d > 0 ? '+' : ''}${d})` : ''); }
  function setDims(d) {
    if (!d) return;
    lastOrig = { oW: d.oW, oH: d.oH };
    setText(wEl, d.nW, d.oW);
    setText(hEl, d.nH, d.oH);
    if (sliding !== 'w') { if (d.nW > +wSlider.max) wSlider.max = d.nW; wSlider.value = d.nW; }
    if (sliding !== 'h') { if (d.nH > +hSlider.max) hSlider.max = d.nH; hSlider.value = d.nH; }
  }
  function open({ tool, label, oW, oH, vw, vh }) {
    clearPickMode();
    titleEl.textContent = tool || 'Resize';
    elEl.textContent = label || '';
    wSlider.max = Math.max(oW * 2, vw || 2000);
    hSlider.max = Math.max(oH * 2, vh || 2000);
    setDims({ oW, oH, nW: oW, nH: oH });
    textarea.value = '';
    panel.hidden = false;
  }
  function close() { panel.hidden = true; textarea.value = ''; sliding = null; }
  function send()   { ipcRenderer.send('resize-panel-send', { instruction: textarea.value.trim() }); close(); }
  function cancel() { ipcRenderer.send('resize-panel-cancel'); close(); }

  // Sliders → live-resize the page element; optimistic text update.
  function wireSlider(slider, dim, valEl) {
    slider.addEventListener('input', () => {
      sliding = dim;
      const v = +slider.value;
      ipcRenderer.send('resize-panel-set', { dim, value: v });
      const orig = dim === 'w' ? lastOrig.oW : lastOrig.oH;
      setText(valEl, v, orig);
    });
    slider.addEventListener('change', () => { sliding = null; });
    slider.addEventListener('mouseup', () => { sliding = null; });
  }
  let lastOrig = { oW: 0, oH: 0 };
  wireSlider(wSlider, 'w', wEl);
  wireSlider(hSlider, 'h', hEl);

  resetBtn.addEventListener('click', () => ipcRenderer.send('resize-panel-reset'));
  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancel);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && document.activeElement !== textarea) { e.preventDefault(); cancel(); }
  });

  ipcRenderer.on('resize-panel-open', (_, data) => open(data || {}));
  ipcRenderer.on('resize-panel-dims', (_, d) => { if (!panel.hidden) setDims(d); });
})();

// ── Extract tool panel (overtakes the chat column) ───────────────
// Mirrors the old in-page Extract popup: targeted elements (hover-highlighted),
// Media (with chat/download dest) + Styles & Content checkboxes, instructions.
// The actual extraction runs in the page on send (window.__cathodePanel.extract).
(function initExtractPanel() {
  const panel    = document.getElementById('extract-panel');
  if (!panel) return;
  const titleEl   = document.getElementById('extract-panel-title');
  const elsEl     = document.getElementById('extract-els');
  const mediaEl   = document.getElementById('extract-media');
  const dataEl    = document.getElementById('extract-data');
  const instr     = document.getElementById('extract-instructions');
  const sendBtn   = document.getElementById('extract-send');
  const cancelBtn = document.getElementById('extract-cancel');
  const segBtns   = panel.querySelectorAll('.ext-seg-btn');

  const MEDIA = [
    { key: 'images', label: 'Images' },
    { key: 'svgs',   label: 'SVGs' },
    { key: 'videos', label: 'Videos' },
  ];
  const DATA = [
    { key: 'styles',     label: 'Element Styles',   analysis: "The selected element's key computed styles — use them to recreate something visually similar." },
    { key: 'palette',    label: 'Color Palette',    analysis: 'List each unique color with its usage count, and flag near-duplicate or off-system values that should consolidate to a design token.' },
    { key: 'typography', label: 'Typography',       analysis: 'Review the type styles and flag combinations that break a consistent type scale (odd sizes, weights, or line-heights).' },
    { key: 'spacing',    label: 'Spacing & Layout', analysis: 'Review the spacing values and flag any that fall off a 4px/8px grid or look inconsistent.' },
    { key: 'tokens',     label: 'Design Tokens',    analysis: 'These are the CSS custom properties (design tokens) in scope. Flag where the selection uses hardcoded values that should reference one of these.' },
    { key: 'dom',        label: 'DOM Structure',    analysis: "The selected element's markup, for reference." },
    { key: 'text',       label: 'Text Content',     analysis: 'Review the visible copy for clarity, consistency, and i18n readiness.' },
    { key: 'forms',      label: 'Form Schema',      analysis: 'Review the form fields and flag any missing labels, name attributes, or validation.' },
    { key: 'a11y',       label: 'Accessibility',    analysis: 'Review the accessibility info and flag interactive elements missing accessible names or with incorrect aria.' },
  ];

  const cbByKey = {};
  function buildChecks(container, list) {
    list.forEach(item => {
      const row = document.createElement('label'); row.className = 'ext-row';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'ext-cb';
      const sp = document.createElement('span'); sp.className = 'ext-label'; sp.textContent = item.label;
      row.append(cb, sp);
      container.appendChild(row);
      cbByKey[item.key] = cb;
    });
  }
  buildChecks(mediaEl, MEDIA);
  buildChecks(dataEl, DATA);

  let dest = 'chat';
  segBtns.forEach(b => b.addEventListener('click', () => {
    dest = b.dataset.dest;
    segBtns.forEach(x => x.classList.toggle('active', x === b));
  }));

  function open({ tool, items }) {
    clearPickMode();
    titleEl.textContent = tool || 'Extract';
    elsEl.innerHTML = '';
    (items || []).forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'ext-el';
      const n = document.createElement('span'); n.className = 'ext-el-name'; n.textContent = it.label;
      n.title = it.cssSelector || it.label;
      row.appendChild(n);
      row.addEventListener('mouseenter', () => ipcRenderer.send('extract-panel-highlight', { active: [i] }));
      row.addEventListener('mouseleave', () => ipcRenderer.send('extract-panel-highlight', { active: [] }));
      elsEl.appendChild(row);
    });
    Object.values(cbByKey).forEach(cb => { cb.checked = false; });
    dest = 'chat'; segBtns.forEach(x => x.classList.toggle('active', x.dataset.dest === 'chat'));
    instr.value = '';
    panel.hidden = false;
  }
  function close() { panel.hidden = true; instr.value = ''; }
  function send() {
    const sel = DATA.filter(d => cbByKey[d.key].checked).map(d => ({ key: d.key, label: d.label, analysis: d.analysis }));
    const mediaTypes = MEDIA.filter(m => cbByKey[m.key].checked).map(m => m.key);
    ipcRenderer.send('extract-panel-send', { sel, mediaTypes, mediaDest: dest, instruction: instr.value.trim() });
    close();
  }
  function cancel() { ipcRenderer.send('extract-panel-cancel'); close(); }

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancel);
  instr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  document.addEventListener('keydown', (e) => { if (!panel.hidden && e.key === 'Escape' && document.activeElement !== instr) { e.preventDefault(); cancel(); } });

  ipcRenderer.on('extract-panel-open', (_, data) => open(data || {}));
})();

// ── Eyedropper tool panel (overtakes the chat column) ────────────
// Loupe sampling stays on the page; this panel shows the targeted element, the
// applicable color property, an old→new compare, and an inline iro picker that
// live-edits the page element (window.__cathodeEyedropper).
(function initEyedropperPanel() {
  const panel     = document.getElementById('eyedropper-panel');
  if (!panel) return;
  const titleEl   = document.getElementById('ed-panel-title');
  const linkEl    = document.getElementById('ed-el-link');
  const propSel   = document.getElementById('ed-prop');
  const oldSw     = document.getElementById('ed-old-sw');
  const oldHex    = document.getElementById('ed-old-hex');
  const iroMount  = document.getElementById('ed-iro');
  const hexInput  = document.getElementById('ed-hex-input');
  const instr     = document.getElementById('ed-instructions');
  const sendBtn   = document.getElementById('ed-send');
  const cancelBtn = document.getElementById('ed-cancel');

  let picker = null, syncing = false, sel = null;

  function ensureIro(cb) {
    if (window.iro) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@jaames/iro@5/dist/iro.min.js';
    s.onload = cb; s.onerror = cb; document.head.appendChild(s);
  }
  function buildPicker(initial) {
    iroMount.innerHTML = '';
    picker = new iro.ColorPicker(iroMount, {
      width: 204, color: initial || '#ffffff',
      layout: [{ component: iro.ui.Box }, { component: iro.ui.Slider, options: { sliderType: 'hue' } }],
    });
    picker.on('color:change', (color) => { if (syncing) return; onPick(color.hexString); });
  }
  function setPicker(hex) { if (!picker) return; syncing = true; try { picker.color.set(hex); } catch (_) {} syncing = false; }
  function setOld(hex) { const h = (hex || '').toUpperCase(); oldSw.style.background = h; oldHex.textContent = h; }
  // The picker itself shows the adjusted color; keep the hex field in sync.
  function setNew(hex) { if (document.activeElement !== hexInput) hexInput.value = (hex || '').toUpperCase(); }
  function onPick(hex) { setNew(hex); ipcRenderer.send('eyedropper-set-color', { hex }); }

  function open(data) {
    clearPickMode();
    sel = data;
    titleEl.textContent = data.tool || 'Eyedropper';
    linkEl.textContent = data.label || data.selector || '';
    linkEl.title = data.selector || '';
    propSel.innerHTML = '';
    (data.props || []).forEach(p => {
      const o = document.createElement('option'); o.value = p.prop; o.textContent = p.label;
      propSel.appendChild(o);
    });
    const ai = data.activeIdx >= 0 ? data.activeIdx : 0;
    if (data.props && data.props[ai]) propSel.value = data.props[ai].prop;
    propSel.disabled = (data.props || []).length <= 1;
    const picked = (data.pickedHex || '#000000').toUpperCase();
    setOld(picked); setNew(picked);
    instr.value = '';
    panel.hidden = false;
    ensureIro(() => { if (!window.iro) return; if (!picker) buildPicker(picked); else setPicker(picked); setNew(picked); hexInput.value = picked; });
  }
  function close() { ipcRenderer.send('cp-clear-target-highlight'); panel.hidden = true; instr.value = ''; }
  function send() { ipcRenderer.send('eyedropper-send', { instruction: instr.value.trim() }); close(); }
  function cancel() { ipcRenderer.send('eyedropper-cancel'); close(); }

  propSel.addEventListener('change', async () => {
    const r = await ipcRenderer.invoke('eyedropper-set-prop', { prop: propSel.value });
    if (r && r.from) { setOld(r.from); setNew(r.from); setPicker(r.from); }
  });
  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return;
    const hex = v.startsWith('#') ? v : '#' + v;
    setPicker(hex);   // suppresses iro change → apply manually
    onPick(hex);
  });
  linkEl.addEventListener('mouseenter', () => { if (sel && sel.selector) ipcRenderer.send('cp-highlight-target', { selector: sel.selector }); });
  linkEl.addEventListener('mouseleave', () => ipcRenderer.send('cp-clear-target-highlight'));
  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancel);
  instr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && document.activeElement !== instr && document.activeElement !== hexInput) { e.preventDefault(); cancel(); }
  });

  ipcRenderer.on('eyedropper-panel-open', (_, data) => open(data || {}));
})();

// ── Accessibility checker panel (overtakes the chat column) ──────
// Page markers stay live; this panel renders the results (grouped, checkbox to
// include, expandable drawers). Contrast issues get live color editors that
// edit the page element (a11y-set-color) and recompute the WCAG ratio locally.
(function initA11yPanel() {
  const panel     = document.getElementById('a11y-panel');
  if (!panel) return;
  const listEl    = document.getElementById('a11y-list');
  const barCount  = document.getElementById('a11y-count');
  const toggleAll = document.getElementById('a11y-toggle-all');
  const sendBtn   = document.getElementById('a11y-send');
  const cancelBtn = document.getElementById('a11y-cancel');

  const ORDER  = ['contrast', 'alt', 'label', 'name'];
  const COLORS = { contrast: '#f59e0b', alt: '#ef4444', label: '#ef4444', name: '#ef4444' };
  function descFor(cat, need) {
    if (cat === 'contrast') return `Text and background fall below the WCAG AA contrast minimum of ${need}:1. Adjust the colors below until it passes.`;
    if (cat === 'alt')   return 'This image has no alt attribute, so screen readers cannot describe it. Add concise alt text — or empty alt if it is purely decorative.';
    if (cat === 'label') return 'This control has no accessible name (no label, aria-label, or title), so assistive tech cannot tell users what it is for.';
    if (cat === 'name')  return 'This button or link has no text or accessible name, so screen readers announce it with nothing to describe it.';
    return '';
  }
  function placeholderFor(cat) {
    if (cat === 'alt')      return 'What does this image show?';
    if (cat === 'label')    return 'What is this control for?';
    if (cat === 'name')     return 'What should this control say?';
    if (cat === 'contrast') return 'Any notes on the color fix?';
    return 'Instructions';
  }
  // WCAG contrast (local — avoids round-tripping to the page on every edit).
  function hexToRgb(h) {
    h = (h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return (h.length === 6 && !isNaN(n)) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } : null;
  }
  function relLum({ r, g, b }) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(h1, h2) {
    const a = hexToRgb(h1), b = hexToRgb(h2);
    if (!a || !b) return null;
    const L1 = relLum(a), L2 = relLum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  let issues = [], state = {}, url = '';

  function updateCount() {
    const n = issues.filter(i => state[i.idx].checked).length;
    barCount.textContent = `${issues.length} issue${issues.length === 1 ? '' : 's'} found`;
    sendBtn.textContent = n ? `Send ${n}` : 'Send';
    sendBtn.disabled = n === 0;
    toggleAll.textContent = n === issues.length && n > 0 ? 'Deselect all' : 'Select all';
  }
  function updateRatio(iss) {
    const st = state[iss.idx];
    if (!st.ratioEl) return;
    const cr = contrast(st.text, st.bg);
    if (cr == null) { st.ratioEl.textContent = ''; return; }
    const pass = cr >= iss.need;
    st.ratioEl.textContent = `${cr.toFixed(2)}:1 — ${pass ? 'Passes AA' : 'Fails AA'}`;
    st.ratioEl.style.color = pass ? '#4ade80' : '#f59e0b';
  }
  function colorEditor(iss, which, initial) {
    const row = el('div', 'a11y-color-row');
    row.append(el('span', 'a11y-color-label', which === 'text' ? 'Text' : 'Background'));
    const sw = el('label', 'a11y-color-sw'); sw.style.background = initial;
    const pick = el('input', 'a11y-color-pick'); pick.type = 'color'; pick.value = initial.toLowerCase();
    sw.appendChild(pick);
    const hex = el('input', 'a11y-color-hex'); hex.type = 'text'; hex.value = initial; hex.spellcheck = false;
    row.append(sw, hex);
    function apply(v) {
      sw.style.background = v;
      state[iss.idx][which] = v.toUpperCase();
      ipcRenderer.send('a11y-set-color', { idx: iss.idx, which, hex: v });
      updateRatio(iss);
    }
    pick.addEventListener('click', e => e.stopPropagation());
    pick.addEventListener('input', e => { e.stopPropagation(); hex.value = pick.value.toUpperCase(); apply(pick.value); });
    hex.addEventListener('click', e => e.stopPropagation());
    hex.addEventListener('input', e => {
      e.stopPropagation();
      let v = hex.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v)) { if (v[0] !== '#') v = '#' + v; pick.value = v.toLowerCase(); apply(v); }
    });
    return row;
  }
  function buildIssue(iss) {
    const wrap = el('div', 'a11y-issue');
    const head = el('div', 'a11y-head');
    const cb = el('input', 'a11y-cb'); cb.type = 'checkbox'; cb.checked = state[iss.idx].checked;
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => { state[iss.idx].checked = cb.checked; updateCount(); });
    const num = el('span', 'a11y-num', String(iss.idx + 1)); num.style.background = COLORS[iss.cat];
    const mid = el('div', 'a11y-mid');
    const row1 = el('div', 'a11y-row1');
    row1.append(el('span', 'a11y-detail', iss.detail || iss.label));
    const badge = el('span', 'a11y-badge', iss.badge);
    badge.style.color = COLORS[iss.cat]; badge.style.background = COLORS[iss.cat] + '1f'; badge.style.border = '1px solid ' + COLORS[iss.cat] + '4d';
    row1.append(badge);
    const selRow = el('div', 'a11y-sel', iss.selector); selRow.title = iss.selector;
    mid.append(row1, selRow);
    const chev = el('span', 'a11y-chev'); chev.innerHTML = '<svg width="9" height="9" viewBox="0 0 10 10" fill="none"><polyline points="3,1.5 6.5,5 3,8.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    head.append(cb, num, mid, chev);

    const body = el('div', 'a11y-body'); body.hidden = true;
    body.append(el('div', 'a11y-desc', descFor(iss.cat, iss.need)));
    if (iss.cat === 'contrast') {
      body.append(colorEditor(iss, 'text', iss.fgHex), colorEditor(iss, 'bg', iss.bgHex));
      const ratio = el('div', 'a11y-ratio'); state[iss.idx].ratioEl = ratio; body.append(ratio); updateRatio(iss);
    }
    const note = el('textarea', 'a11y-note'); note.rows = 2; note.placeholder = placeholderFor(iss.cat);
    note.addEventListener('click', e => e.stopPropagation());
    note.addEventListener('input', () => { state[iss.idx].instruction = note.value; });
    body.append(note);

    head.addEventListener('click', (e) => {
      if (e.target === cb) return;
      const open = body.hidden;
      body.hidden = !open;
      chev.classList.toggle('open', open);
      if (open) ipcRenderer.send('a11y-flash', { idx: iss.idx });
    });
    wrap.append(head, body);
    return wrap;
  }

  function render() {
    listEl.innerHTML = '';
    if (!issues.length) { listEl.appendChild(el('div', 'a11y-empty', 'No contrast or a11y issues found.')); return; }
    const byCat = {};
    issues.forEach(i => { (byCat[i.cat] = byCat[i.cat] || []).push(i); });
    ORDER.forEach(cat => {
      const list = byCat[cat]; if (!list) return;
      listEl.appendChild(el('div', 'a11y-group-title', `${list[0].label} (${list.length})`));
      list.forEach(iss => listEl.appendChild(buildIssue(iss)));
    });
  }

  function open(data) {
    clearPickMode();
    issues = data.issues || [];
    url = data.url || '';
    state = {};
    issues.forEach(i => { state[i.idx] = { checked: true, instruction: '', text: i.fgHex, bg: i.bgHex }; });
    render();
    updateCount();
    panel.hidden = false;
  }
  function close() { panel.hidden = true; listEl.innerHTML = ''; issues = []; state = {}; }
  function send() {
    const out = issues.filter(i => state[i.idx].checked).map(i => {
      const st = state[i.idx];
      const o = { category: i.label, selector: i.selector, detail: i.detail, instruction: (st.instruction || '').trim(), url };
      if (i.cat === 'contrast') { o.fromText = i.fgHex; o.fromBg = i.bgHex; o.toText = (st.text || i.fgHex).toUpperCase(); o.toBg = (st.bg || i.bgHex).toUpperCase(); }
      return o;
    });
    ipcRenderer.send('a11y-send', { issues: out });
    close();
  }
  function cancel() { ipcRenderer.send('a11y-cancel'); close(); }

  toggleAll.addEventListener('click', () => {
    const allOn = issues.every(i => state[i.idx].checked);
    const next = !allOn;
    issues.forEach(i => { state[i.idx].checked = next; });
    listEl.querySelectorAll('.a11y-cb').forEach(cb => { cb.checked = next; });
    updateCount();
  });
  sendBtn.addEventListener('click', () => { if (!sendBtn.disabled) send(); });
  cancelBtn.addEventListener('click', cancel);
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && !/^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) { e.preventDefault(); cancel(); }
  });

  ipcRenderer.on('a11y-panel-open', (_, data) => open(data || {}));
})();

// ── Screenshot tool panel (overtakes the chat column) ────────────
// The region is captured + saved in main; this panel just previews the image
// and takes an optional instruction before handing the file path to chat.
(function initScreenshotPanel() {
  const panel     = document.getElementById('screenshot-panel');
  if (!panel) return;
  const img       = document.getElementById('ss-preview-img');
  const instr     = document.getElementById('ss-instructions');
  const sendBtn   = document.getElementById('ss-send');
  const cancelBtn = document.getElementById('ss-cancel');

  function open(data) {
    clearPickMode();
    img.src = data.dataUrl || '';
    instr.value = '';
    panel.hidden = false;
    setTimeout(() => instr.focus(), 0);
  }
  function close() { panel.hidden = true; img.removeAttribute('src'); instr.value = ''; }
  function send() { ipcRenderer.send('screenshot-panel-send', { instruction: instr.value.trim() }); close(); }
  function cancel() { ipcRenderer.send('screenshot-panel-cancel'); close(); }

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancel);
  instr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && document.activeElement !== instr) { e.preventDefault(); cancel(); }
  });

  ipcRenderer.on('screenshot-panel-open', (_, data) => open(data || {}));
})();

// ── System performance graph (CPU / RAM / GPU) ───────────────────────
// App-bar toggle: show/hide the graph (persisted, default on).
// Generic height grow-in / shrink-out for a panel (same feel as the usage panel).
function growPanel(el, open) {
  if (el._growAnim) el._growAnim();   // cancel any in-flight grow/shrink
  const finish = (after) => {
    const done = () => {
      el.style.transition = ''; el.style.height = ''; el.style.overflow = '';
      el.removeEventListener('transitionend', onEnd); clearTimeout(t); el._growAnim = null;
      if (after) after();
    };
    const onEnd = (e) => { if (!e || e.propertyName === 'height') done(); };
    const t = setTimeout(done, 380);
    el.addEventListener('transitionend', onEnd);
    el._growAnim = done;
  };
  if (open) {
    el.style.display = '';
    const end = el.scrollHeight;
    el.style.overflow = 'hidden';
    el.style.height = '0px';
    void el.offsetHeight;
    el.style.transition = 'height 0.3s cubic-bezier(0.45,0.05,0.2,1)';
    el.style.height = end + 'px';
    finish();
  } else {
    el.style.overflow = 'hidden';
    el.style.height = el.offsetHeight + 'px';
    void el.offsetHeight;
    el.style.transition = 'height 0.3s cubic-bezier(0.45,0.05,0.2,1)';
    el.style.height = '0px';
    finish(() => { el.style.display = 'none'; });
  }
}

(function initSysperfToggle() {
  const btn = document.getElementById('btn-sysperf-toggle');
  const panel = document.getElementById('sysperf');
  if (!btn || !panel) return;
  let on = localStorage.getItem(LS.sysperf) !== '0';
  panel.style.display = on ? '' : 'none';   // initial state (no animation)
  btn.classList.toggle('active', on);
  ipcRenderer.send('sysperf-active', on);   // only sample/tick in main while the panel is open
  btn.addEventListener('click', () => {
    on = !on;
    localStorage.setItem(LS.sysperf, on ? '1' : '0');
    btn.classList.toggle('active', on);
    ipcRenderer.send('sysperf-active', on);
    growPanel(panel, on);                   // animate grow-in / shrink-out on toggle
  });
})();

// View toggle: All (resource bars) ↔ RAM ↔ CPU (top processes). The process
// views poll main only while open and the panel is visible.
(function initSysperfView() {
  const allBtn  = document.getElementById('sysperf-view-all');
  const ramBtn  = document.getElementById('sysperf-view-ram');
  const cpuBtn  = document.getElementById('sysperf-view-cpu');
  const barsEl  = document.getElementById('sysperf-bars');
  const procsEl = document.getElementById('sysperf-procs');
  const titleEl = document.getElementById('sysperf-title');
  const panel   = document.getElementById('sysperf');
  if (!allBtn || !ramBtn || !cpuBtn || !barsEl || !procsEl) return;

  const VIEWS = ['all', 'ram', 'cpu'];
  let stored = localStorage.getItem(LS.sysperfView);
  if (stored === 'bars')  stored = 'all';     // migrate old keys
  if (stored === 'procs') stored = 'ram';
  let view  = VIEWS.includes(stored) ? stored : 'all';
  let timer = null;

  const ROWS = 6;
  let prevIsAll = null;

  function fmtBytes(b) {
    const gb = b / (1024 ** 3);
    if (gb >= 1) return gb.toFixed(1) + ' GB';
    return Math.round(b / (1024 ** 2)) + ' MB';
  }
  // Persistent rows: reusing the same nodes lets the bars animate (via the CSS
  // `width` transition) into place and between polls instead of popping.
  function ensureRows() {
    if (procsEl.childElementCount === ROWS && procsEl.firstElementChild.classList.contains('sysperf-proc')) return;
    let html = '';
    for (let i = 0; i < ROWS; i++) {
      html += '<div class="sysperf-proc" style="display:none">'
            + '<span class="sysperf-proc-name"></span>'
            + '<div class="sysperf-bar"></div>'
            + '<span class="sysperf-proc-mem"></span></div>';
    }
    procsEl.innerHTML = html;
  }
  function renderProcs(res, kind) {
    if (!res || !res.ok || !res.procs || !res.procs.length) {
      procsEl.innerHTML = '<div class="sysperf-proc-empty">Process data unavailable</div>';
      return;
    }
    ensureRows();
    const rows = procsEl.children;
    const procs = res.procs;
    const max = procs[0].value || 1;
    for (let i = 0; i < ROWS; i++) {
      const row = rows[i];
      if (i < procs.length) {
        const p = procs[i];
        const name = row.children[0], bar = row.children[1], mem = row.children[2];
        row.style.display = '';
        name.textContent = p.name; name.title = p.name;
        const ppct = Math.max(3, Math.round(100 * p.value / max));
        bar.innerHTML = usageSegments(ppct, Math.max(20, Math.round((bar.clientWidth || 200) / 4)));
        mem.textContent = kind === 'cpu' ? Math.round(p.value) + '%' : fmtBytes(p.value);
      } else {
        row.style.display = 'none';
      }
    }
  }
  async function pollProcs() {
    if (view === 'all' || (panel && panel.style.display === 'none')) return;
    const kind = view;   // 'ram' | 'cpu'
    let res = null;
    try { res = await ipcRenderer.invoke('top-procs', kind); } catch (_) {}
    if (view !== kind) return;   // view changed mid-flight
    renderProcs(res, kind);
  }
  function fadeShow(el) {
    el.style.display = '';
    el.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
  }
  function apply() {
    const isAll = view === 'all';
    allBtn.classList.toggle('active', view === 'all');
    ramBtn.classList.toggle('active', view === 'ram');
    cpuBtn.classList.toggle('active', view === 'cpu');
    if (titleEl) titleEl.textContent = isAll ? 'System' : (view === 'ram' ? 'Top RAM' : 'Top CPU');

    // Crossfade only when switching between the bars and the process list;
    // RAM↔CPU keeps the same container (rows morph in place — no flash).
    if (prevIsAll !== isAll) {
      if (isAll) { procsEl.style.display = 'none'; fadeShow(barsEl); }
      else       { barsEl.style.display = 'none'; ensureRows(); fadeShow(procsEl); }
    } else if (!isAll) {
      ensureRows();
    }
    prevIsAll = isAll;

    if (timer) { clearInterval(timer); timer = null; }
    if (!isAll) { pollProcs(); timer = setInterval(pollProcs, 3000); }
  }
  function set(v) { view = v; localStorage.setItem(LS.sysperfView, v); apply(); }
  allBtn.addEventListener('click', () => set('all'));
  ramBtn.addEventListener('click', () => set('ram'));
  cpuBtn.addEventListener('click', () => set('cpu'));
  apply();
})();

ipcRenderer.on('sysperf', (_, m) => {
  const set = (key, val) => {
    const bar = document.getElementById(`sysperf-${key}-bar`);
    const pct = document.getElementById(`sysperf-${key}-pct`);
    if (!bar || !pct) return;
    const n = Math.max(20, Math.round((bar.clientWidth || 200) / 4));   // ~2px segs + 2px gaps
    if (val == null || isNaN(val)) { bar.innerHTML = usageSegments(0, n); pct.textContent = '—'; return; }
    const v = Math.max(0, Math.min(100, Math.round(val)));
    bar.innerHTML   = usageSegments(v, n);   // same segmented LED style as the usage bars
    pct.textContent = v + '%';
  };
  set('cpu', m && m.cpu); set('ram', m && m.ram); set('gpu', m && m.gpu);
});

// Route a message to the active session — chat (ACP) or PTY. The single
// sending path for tools, audits, and the composer. `display` is what the
// chat bubble shows when it differs from the full prompt text (e.g. chip
// summaries instead of full Figma instructions).
// Esc-to-stop: interrupt the active agent. ACP → cancel the running prompt
// (only when it's actually working); PTY → send Ctrl-C.
function interruptActiveSession() {
  const s = sessions.get(activeId);
  if (!s) return false;
  if (s.type === 'acp') {
    if (s.status !== 'thinking') return false;
    ipcRenderer.send('acp-cancel', { id: activeId });
    return true;
  }
  ipcRenderer.send('pty-input', { id: activeId, data: '\x03' });
  return true;
}

// Returns true if there was an active session to receive the message.
function routeToActiveSession(text, display = text, images = [], chips = null) {
  const s = sessions.get(activeId);
  if (!s) return false;
  if (s.type === 'acp') {
    acpAddUserMsg(s, display, images, chips);
    acpSetStatus(s, 'thinking');
    ipcRenderer.send('acp-prompt', { id: activeId, text });
  } else {
    s.term.paste(text);
    setTimeout(() => ipcRenderer.send('pty-input', { id: activeId, data: '\r' }), PTY_SEND_DELAY);
  }
  return true;
}

// Route pick/screenshot output to the active session
ipcRenderer.on('pick-send-to-session', (_, message) => routeToActiveSession(message));

// Passive update indicator: a dismissible toast (click → run the update flow)
// plus a persistent dot on the settings gear.
ipcRenderer.on('update-available', (_, { behind }) => {
  const gear = document.getElementById('btn-settings');
  if (gear) gear.classList.add('has-update');
  const t = showToast(`↑ ${behind} update${behind === 1 ? '' : 's'} available — click to update`, { duration: 9000 });
  if (t && t.el) {
    t.el.style.cursor = 'pointer';
    t.el.addEventListener('click', () => { ipcRenderer.send('app-check-updates'); t.dismiss(); });
  }
});

// ── Console & Network tab ─────────────────────────────────────────
(function initConsole() {
  const listEl  = document.getElementById('console-list');
  const emptyEl = document.getElementById('console-empty');
  const countEl = document.getElementById('console-count');
  if (!listEl) return;

  const MAX = 800;
  let entries = [];
  let filter = 'all';
  const LC = { error: '#ef4444', warn: '#f59e0b', info: '#4a9eff', debug: '#777', log: '#bbb' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const shortSrc = (s) => { try { const u = new URL(s); return (u.pathname.split('/').pop() || u.hostname); } catch (_) { return String(s).split('/').pop() || s; } };

  function matches(e) {
    if (filter === 'all')   return true;
    if (filter === 'net')   return e.kind === 'net';
    if (filter === 'error') return e.kind === 'net' || e.level === 'error';
    if (filter === 'warn')  return e.kind === 'console' && e.level === 'warn';
    return true;
  }
  function isErr(e) { return e.kind === 'net' || e.level === 'error'; }

  function rowHtml(e) {
    if (e.kind === 'net') {
      const status = e.error ? e.error.replace('net::', '') : (e.status || '');
      return '<div class="console-row net" data-id="' + e.id + '">'
        + '<span class="c-tag net">NET</span>'
        + '<span class="c-method">' + esc(e.method || 'GET') + '</span>'
        + '<span class="c-status bad">' + esc(status) + '</span>'
        + '<span class="c-msg">' + esc(e.url) + '</span>'
        + '<button class="c-send" title="Send to chat">→</button></div>';
    }
    return '<div class="console-row ' + e.level + '" data-id="' + e.id + '">'
      + '<span class="c-tag" style="color:' + (LC[e.level] || '#bbb') + '">' + e.level.toUpperCase() + '</span>'
      + '<span class="c-msg" style="color:' + (e.level === 'error' ? '#f3b0b0' : e.level === 'warn' ? '#e7c98a' : '#cfcfcf') + '">' + esc(e.text) + '</span>'
      + (e.source ? '<span class="c-src">' + esc(shortSrc(e.source)) + (e.line ? ':' + e.line : '') + '</span>' : '')
      + '<button class="c-send" title="Send to chat">→</button></div>';
  }
  function updateCount() {
    const errs = entries.filter(isErr).length;
    countEl.textContent = entries.length + (errs ? ' · ' + errs + ' err' : '');
  }
  function render() {
    listEl.innerHTML = entries.filter(matches).map(rowHtml).join('');
    emptyEl.style.display = entries.length ? 'none' : '';
    updateCount();
    listEl.scrollTop = listEl.scrollHeight;
  }
  function add(e) {
    entries.push(e);
    if (entries.length > MAX) entries.shift();
    if (consolePanel && consolePanel.style.display !== 'none') {
      if (matches(e)) {
        const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
        listEl.insertAdjacentHTML('beforeend', rowHtml(e));
        emptyEl.style.display = 'none';
        if (atBottom) listEl.scrollTop = listEl.scrollHeight;
      }
      updateCount();
    }
  }
  function sendOne(e) {
    let msg;
    if (e.kind === 'net') {
      msg = '───── Failed request ─────\n' + (e.method || 'GET') + ' ' + e.url + '\n'
        + (e.error ? 'Error: ' + e.error : 'Status: ' + e.status) + '\n\nFind and fix what makes this request fail.';
    } else {
      msg = '───── Console ' + e.level + ' ─────\n' + e.text
        + (e.source ? '\nAt: ' + e.source + (e.line ? ':' + e.line : '') : '') + '\n\nInvestigate and fix this.';
    }
    showToast(routeToActiveSession(msg) ? 'Sent to chat' : 'No active session', { duration: 1500 });
  }

  ipcRenderer.on('console-entry', (_, e) => add(e));
  ipcRenderer.invoke('console-get').then(list => { entries = (list || []).slice(-MAX); render(); }).catch(() => {});

  document.querySelectorAll('.console-filter').forEach(b => {
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      document.querySelectorAll('.console-filter').forEach(x => x.classList.toggle('active', x === b));
      render();
    });
  });
  document.getElementById('console-clear').addEventListener('click', () => {
    entries = []; ipcRenderer.send('console-clear'); render();
  });
  document.getElementById('console-send-errors').addEventListener('click', () => {
    const errs = entries.filter(isErr);
    if (!errs.length) { showToast('No errors to send', { duration: 1400 }); return; }
    const lines = ['───── Console errors (' + errs.length + ') ─────'];
    errs.forEach(e => {
      if (e.kind === 'net') lines.push('• [request] ' + (e.method || 'GET') + ' ' + e.url + ' — ' + (e.error || ('HTTP ' + e.status)));
      else lines.push('• [console] ' + e.text + (e.source ? '  (' + shortSrc(e.source) + (e.line ? ':' + e.line : '') + ')' : ''));
    });
    lines.push('', 'Investigate and fix these.');
    showToast(routeToActiveSession(lines.join('\n')) ? 'Sent ' + errs.length + ' to chat' : 'No active session', { duration: 1500 });
  });
  listEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.c-send'); if (!btn) return;
    const id = +btn.closest('.console-row').dataset.id;
    const e = entries.find(x => x.id === id); if (e) sendOne(e);
  });

  window.__onConsoleTabActive = () => render();
})();

// ── Changes / Diff tab ────────────────────────────────────────────
(function initDiff() {
  const panel = document.getElementById('diff-panel');
  if (!panel) return;
  const listEl   = document.getElementById('diff-list');
  const emptyEl  = document.getElementById('diff-empty');
  const editorEl = document.getElementById('diff-editor');
  const branchEl = document.getElementById('diff-branch');
  const sendBtn  = document.getElementById('diff-send');

  let monaco = null, diffEditor = null, models = null;
  let files = [], selected = null;
  let reqToken = 0;   // guards against out-of-order diff-file responses

  const EXT_LANG = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', json: 'json', html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less', md: 'markdown', markdown: 'markdown',
    py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    cs: 'csharp', php: 'php', rb: 'ruby', sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml', sql: 'sql', vue: 'html', svelte: 'html', toml: 'ini', ini: 'ini',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const base = (p) => String(p).split(/[\\/]/).pop() || p;
  function langFor(name) {
    const b = name.toLowerCase();
    if (b === 'dockerfile' || b.startsWith('dockerfile.')) return 'dockerfile';
    const ext = b.includes('.') ? b.split('.').pop() : '';
    return EXT_LANG[ext] || 'plaintext';
  }
  function loadMonaco() {
    return new Promise(res => {
      if (window.monaco) return res(window.monaco);
      if (!window.__amdRequire) return res(null);
      window.__amdRequire(['vs/editor/editor.main'], () => res(window.monaco));
    });
  }
  async function ensureEditor() {
    if (diffEditor) return diffEditor;
    monaco = await loadMonaco();
    if (!monaco) return null;
    diffEditor = monaco.editor.createDiffEditor(editorEl, {
      readOnly: true, theme: 'vs-dark', automaticLayout: true, renderSideBySide: true,
      fontSize: 12.5, lineHeight: 18, minimap: { enabled: false }, scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    });
    return diffEditor;
  }

  const SM = {
    added:    { l: 'A', c: '#4ade80' },
    modified: { l: 'M', c: '#f59e0b' },
    deleted:  { l: 'D', c: '#ef4444' },
    renamed:  { l: 'R', c: '#4a9eff' },
  };
  function renderList() {
    listEl.innerHTML = files.map((f, i) => {
      const m = SM[f.status] || SM.modified;
      const st = (f.added != null || f.deleted != null)
        ? '<span class="diff-stat"><span class="add">+' + (f.added || 0) + '</span><span class="del">−' + (f.deleted || 0) + '</span></span>' : '';
      return '<div class="diff-file' + (selected && f.rel === selected.rel ? ' active' : '') + '" data-i="' + i + '">'
        + '<span class="diff-badge" style="color:' + m.c + ';border-color:' + m.c + '66">' + m.l + '</span>'
        + '<span class="diff-name" title="' + esc(f.rel) + '">' + esc(f.rel) + '</span>' + st + '</div>';
    }).join('');
  }
  function showEmpty(reason) {
    editorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    emptyEl.textContent =
      reason === 'no-folder' ? 'Open a project folder to see its changes.' :
      reason === 'not-git'   ? 'This folder is not a git repository.' :
      reason === 'no-git'    ? 'Git was not found — install it or add it to PATH.' :
      'No uncommitted changes — the working tree is clean.';
  }
  async function selectFile(f) {
    const token = ++reqToken;          // captured before any await (matches click order)
    selected = f; renderList();
    const ed = await ensureEditor();
    if (!ed) { showEmpty('no-git'); return; }
    if (token !== reqToken) return;    // superseded while Monaco loaded
    let res;
    try { res = await ipcRenderer.invoke('diff-file', { rel: f.rel, status: f.status }); }
    catch (_) { res = null; }
    if (token !== reqToken) return;    // a newer selection won — drop this stale result
    emptyEl.style.display = 'none';
    editorEl.style.display = '';
    const lang = res && res.binary ? 'plaintext' : langFor(base(f.rel));
    const before = res && res.binary ? '(binary file)' : ((res && res.before) || '');
    const after  = res && res.binary ? '(binary file)' : ((res && res.after) || '');
    const orig = monaco.editor.createModel(before, lang);
    const mod  = monaco.editor.createModel(after, lang);
    ed.setModel({ original: orig, modified: mod });
    ed.layout();
    if (models) { models.original.dispose(); models.modified.dispose(); }
    models = { original: orig, modified: mod };
  }
  async function refresh() {
    const res = await ipcRenderer.invoke('diff-status');
    if (!res || !res.ok) { files = []; selected = null; branchEl.textContent = ''; renderList(); showEmpty(res ? res.reason : 'not-git'); return; }
    branchEl.textContent = res.branch || '';
    files = res.files || [];
    renderList();
    if (!files.length) { selected = null; showEmpty('clean'); return; }
    const keep = selected && files.find(f => f.rel === selected.rel);
    selectFile(keep || files[0]);
  }

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.diff-file'); if (!row) return;
    const f = files[+row.dataset.i]; if (f) selectFile(f);
  });
  document.getElementById('diff-refresh').addEventListener('click', refresh);
  sendBtn.addEventListener('click', () => {
    if (!files.length) { showToast('No changes to review', { duration: 1400 }); return; }
    const lines = ['───── Review my uncommitted changes ─────'];
    if (branchEl.textContent) lines.push('Branch: ' + branchEl.textContent, '');
    files.forEach(f => {
      const tag = (SM[f.status] || SM.modified).l;
      const st = (f.added != null || f.deleted != null) ? '  (+' + (f.added || 0) + ' −' + (f.deleted || 0) + ')' : '';
      lines.push(tag + '  ' + f.rel + st);
    });
    lines.push('', 'Walk through these changes and flag anything incorrect, risky, or incomplete.');
    showToast(routeToActiveSession(lines.join('\n'))
      ? 'Sent ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' to chat'
      : 'No active session', { duration: 1500 });
  });

  window.__onDiffTabActive = () => { refresh(); if (diffEditor) setTimeout(() => diffEditor.layout(), 0); };
})();

// Composite draw canvas over page screenshot in the renderer (has Canvas API)
// ── Draw tool panel (overtakes the chat column) ─────────────────
// The page+annotation composite (built in the draw-composite handler below) is
// previewed here; on Send the composite is saved + sent with the instruction.
let openDrawPanel = null;
(function initDrawPanel() {
  const panel     = document.getElementById('draw-panel');
  if (!panel) return;
  const img       = document.getElementById('draw-preview-img');
  const instr     = document.getElementById('draw-instructions');
  const sendBtn   = document.getElementById('draw-send');
  const cancelBtn = document.getElementById('draw-cancel');
  let compositeDataUrl = '';

  function close() { panel.hidden = true; img.removeAttribute('src'); instr.value = ''; compositeDataUrl = ''; }
  function send() {
    ipcRenderer.send('draw-composite-done', { compositeDataUrl, instructions: instr.value.trim() });
    close();
  }
  function cancel() { close(); }   // nothing persisted until Send, so just dismiss

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancel);
  instr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && document.activeElement !== instr) { e.preventDefault(); cancel(); }
  });

  openDrawPanel = function(dataUrl) {
    clearPickMode();
    compositeDataUrl = dataUrl;
    img.src = dataUrl;
    instr.value = '';
    panel.hidden = false;
    setTimeout(() => instr.focus(), 0);
  };
})();

ipcRenderer.on('draw-composite', async (_, { pageB64, canvasDataUrl }) => {
  const offscreen = document.createElement('canvas');
  const img1 = new Image(), img2 = new Image();
  img1.src = 'data:image/png;base64,' + pageB64;
  img2.src = canvasDataUrl;
  await Promise.all([
    new Promise(r => { img1.onload = r; img1.onerror = r; }),
    new Promise(r => { img2.onload = r; img2.onerror = r; }),
  ]);
  offscreen.width  = img1.naturalWidth  || img2.naturalWidth;
  offscreen.height = img1.naturalHeight || img2.naturalHeight;
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(img1, 0, 0);
  ctx.drawImage(img2, 0, 0);
  // Preview + instruction now live in the left-column panel.
  if (openDrawPanel) openDrawPanel(offscreen.toDataURL('image/png'));
});

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); addressBar.focus(); }
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); createTab(''); }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
  if (e.key === 'F5')  ipcRenderer.send('browser-reload');
  if (e.key === 'F12') ipcRenderer.send('browser-toggle-devtools');
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '\\') { e.preventDefault(); btnPanelToggle.click(); }

  // Escape — cancel active tool
  if (e.key === 'Escape' && pickMode) {
    ipcRenderer.send('pick-cancel');
    clearPickMode();
  }

  // Save prompt
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
    e.preventDefault();
    if (uiTextarea.value.trim()) btnSavePrompt.click();
  }
});

// ── Shortcut actions forwarded from main.js before-input-event ──────────
// before-input-event fires in the main process for whichever WebContentsView
// currently has keyboard focus, then sends this IPC to the renderer. Tool
// shortcuts are Alt+<letter>, so no input-focus guard is needed.
const TOOL_BTN = Object.fromEntries(PAGE_TOOLS.map(t => [t.key, t.id]));
ipcRenderer.on('shortcut-action', (_, action) => {
  if (action.type === 'tab-switch') {
    const idx = tabsConfig.findIndex(t => t.id === activeViewTabId);
    if (idx !== -1) activateViewTab(tabsConfig[(idx + action.dir + tabsConfig.length) % tabsConfig.length].id);
  } else if (action.type === 'tool') {
    document.getElementById(TOOL_BTN[action.key])?.click();
  } else if (action.type === 'panel-toggle') {
    btnPanelToggle.click();
  } else if (action.type === 'escape') {
    if (pickMode) { ipcRenderer.send('pick-cancel'); clearPickMode(); }
    // Esc anywhere else stops the agent — but let the composer's own keydown
    // own that case (and the slash menu) when it's focused.
    else if (document.activeElement !== uiTextarea) interruptActiveSession();
  }
});

// ── Left-panel mode: Terminal ↔ UI ────────────────────────────────
const uiTextarea  = document.getElementById('ui-textarea');
const uiCharCount = document.getElementById('ui-char-count');
let msgHistory = [];
let historyIdx  = 0;



// ── Audit types (persisted) ───────────────────────────────────────
const AUDIT_TYPES_DEFAULT = [
  { label: 'Correctness',     prompt: 'Run a correctness audit on this codebase. Check for logic bugs, off-by-one errors, edge cases not handled, race conditions, unhandled promise rejections, and dead or unreachable code. Report findings only — do not make changes.' },
  { label: 'Security',        prompt: 'Run a security audit on this codebase. Check for injection vulnerabilities (XSS, SQL, command injection), unsafe use of eval, sensitive data hardcoded in source, authentication or authorization gaps, and insecure storage. Report findings only — do not make changes.' },
  { label: 'Performance',     prompt: 'Run a performance audit on this codebase. Check for unnecessary work in hot paths, memory leaks (event listeners not removed, unbounded collections), expensive operations inside loops, and repeated DOM queries that could be cached. Report findings only — do not make changes.' },
  { label: 'Maintainability', prompt: 'Run a maintainability audit on this codebase. Check for duplicated logic, magic numbers or strings that should be named constants, overly complex functions, inconsistent naming or patterns, and non-obvious behavior lacking any explanation. Report findings only — do not make changes.' },
  { label: 'Reliability',     prompt: 'Run a reliability audit on this codebase. Check for missing null/undefined guards at system boundaries, unhandled failure cases from external calls, state that can get out of sync between components, and assumptions that may not hold at runtime. Report findings only — do not make changes.' },
  { label: 'Accessibility',   prompt: 'Run an accessibility audit on this codebase. Check for missing ARIA roles and labels, interactive elements unreachable by keyboard, focus not managed on dynamic content, missing alt text on images, and hardcoded colors that may have insufficient contrast. Report findings only — do not make changes.' },
  { label: 'Dependencies',    prompt: 'Run a dependency audit on this project. Review package.json and any lock files for outdated packages, abandoned or unmaintained libraries, known vulnerability patterns, and packages pulling in far more than needed for the task. Report findings only — do not make changes.' },
];

let auditTypes = (() => {
  try {
    const stored = localStorage.getItem(LS.auditTypes);
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  return AUDIT_TYPES_DEFAULT.map(t => ({ ...t }));
})();

function buildAuditMenu() {
  const auditMenu = document.getElementById('audit-menu');
  if (!auditMenu) return;
  auditMenu.innerHTML = auditTypes.map((t, i) =>
    `<div class="audit-item" data-i="${i}"><span class="audit-item-label">${escHtml(t.label)}</span></div>`
  ).join('')
  + `<div class="audit-divider"></div>`
  + `<div class="audit-item audit-item-edit" data-action="edit-prompts"><span class="audit-item-label">Edit prompts…</span></div>`;
}

(function initAuditDropdown() {
  const btnAudit  = document.getElementById('btn-audit');
  const auditMenu = document.getElementById('audit-menu');
  if (!btnAudit || !auditMenu) return;

  buildAuditMenu();

  btnAudit.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = auditMenu.classList.toggle('open');
    btnAudit.classList.toggle('active', isOpen);
  });

  auditMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.audit-item');
    if (!item) return;
    auditMenu.classList.remove('open');
    btnAudit.classList.remove('active');
    if (item.dataset.action === 'edit-prompts') {
      openAuditPromptsModal?.();
      return;
    }
    const audit = auditTypes[parseInt(item.dataset.i)];
    if (!audit) return;
    if (!activeId) return;
    routeToActiveSession(audit.prompt);
  });

  document.addEventListener('click', (e) => {
    if (!auditMenu.classList.contains('open')) return;
    if (!btnAudit.contains(e.target) && !auditMenu.contains(e.target)) {
      auditMenu.classList.remove('open');
      btnAudit.classList.remove('active');
    }
  });
})();

// ── Audit prompts modal ───────────────────────────────────────────
(function initAuditPromptsModal() {
  const modal     = document.getElementById('audit-prompts-modal');
  const list      = document.getElementById('audit-prompts-list');
  const addBtn    = document.getElementById('audit-prompts-add');
  const cancelBtn = document.getElementById('audit-prompts-cancel');
  const saveBtn   = document.getElementById('audit-prompts-save');
  if (!modal) return;

  const esc = escHtml;

  function addCard(label = '', prompt = '', expanded = false) {
    const card = document.createElement('div');
    card.className = 'ap-card' + (expanded ? ' expanded' : '');
    card.innerHTML = `
      <div class="ap-card-row">
        <span class="ap-chevron">${chevronRightIcon(14)}</span>
        <span class="ap-card-name"></span>
        <button class="ap-delete" title="Remove prompt">${trashIcon(15)}</button>
      </div>
      <div class="ap-card-body">
        <span class="ap-field-title">Label</span>
        <input class="ap-label" placeholder="e.g. Security" value="${esc(label)}" />
        <span class="ap-field-title">Prompt</span>
        <textarea class="ap-prompt" rows="3" placeholder="Audit prompt sent to Claude Code...">${esc(prompt)}</textarea>
      </div>
    `;
    const nameEl  = card.querySelector('.ap-card-name');
    const labelIn = card.querySelector('.ap-label');
    const syncName = () => {
      const v = labelIn.value.trim();
      nameEl.innerHTML = v ? esc(v) : '<em>New prompt</em>';
    };
    syncName();
    labelIn.addEventListener('input', syncName);

    card.querySelector('.ap-card-row').addEventListener('click', (e) => {
      if (e.target.closest('.ap-delete')) return;
      card.classList.toggle('expanded');
    });
    card.querySelector('.ap-delete').addEventListener('click', () => card.remove());
    list.appendChild(card);
    return card;
  }

  function renderCards() {
    list.innerHTML = '';
    auditTypes.forEach(t => addCard(t.label, t.prompt));
  }

  const ctl = wireModal(modal);

  addBtn.addEventListener('click', () => {
    const card = addCard('', '', true);
    card.querySelector('.ap-label').focus();
  });

  cancelBtn.addEventListener('click', ctl.close);

  saveBtn.addEventListener('click', () => {
    const updated = [];
    list.querySelectorAll('.ap-card').forEach(card => {
      const label  = card.querySelector('.ap-label').value.trim();
      const prompt = card.querySelector('.ap-prompt').value.trim();
      if (label && prompt) updated.push({ label, prompt });
    });
    auditTypes = updated;
    localStorage.setItem(LS.auditTypes, JSON.stringify(auditTypes));
    buildAuditMenu();
    ctl.close();
  });

  openAuditPromptsModal = function() {
    renderCards();
    ctl.open();
  };
})();

// ── Edit Tabs modal ───────────────────────────────────────────────
(function initEditTabsModal() {
  const modal      = document.getElementById('tabs-modal');
  const listEl     = document.getElementById('tabs-modal-list');
  const addSel     = document.getElementById('tabs-add-select');
  const addBtn     = document.getElementById('tabs-add-btn');
  const urlFields  = document.getElementById('tabs-add-url-fields');
  const addLabelIn = document.getElementById('tabs-add-label');
  const addUrlIn   = document.getElementById('tabs-add-url-input');
  const cancelBtn  = document.getElementById('tabs-modal-cancel');
  const saveBtn    = document.getElementById('tabs-modal-save');
  if (!modal) return;

  // Both derived from the TAB_TYPES catalog — see its comment.
  const BUILTIN_DEFAULTS = Object.fromEntries(BUILTIN_TAB_ORDER.map(t => [t, defaultTabFor(t)]));
  const BUILTIN_OPTIONS  = BUILTIN_TAB_ORDER.map(t => ({ value: t, label: TAB_TYPES[t].label }));

  const esc = escHtml;

  let draft = [];
  let dragSrcIdx = -1;

  function updateAddSelect() {
    const prev = addSel.value;
    addSel.innerHTML = '';
    BUILTIN_OPTIONS.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      addSel.appendChild(opt);
    });
    const urlOpt = document.createElement('option');
    urlOpt.value = 'url'; urlOpt.textContent = 'Custom URL…';
    addSel.appendChild(urlOpt);
    if ([...addSel.options].some(o => o.value === prev)) addSel.value = prev;
    if (addSel.value === 'url') urlFields.classList.add('visible');
    else urlFields.classList.remove('visible');
    updateAddBtn();
  }

  const GRIP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="16" height="16" fill="currentColor"><circle cx="9" cy="6.75" r="1.25"/><circle cx="14.25" cy="6.75" r="1.25"/><circle cx="3.75" cy="6.75" r="1.25"/><circle cx="9" cy="11.25" r="1.25"/><circle cx="14.25" cy="11.25" r="1.25"/><circle cx="3.75" cy="11.25" r="1.25"/></svg>`;

  function renderList() {
    listEl.innerHTML = '';
    draft.forEach((tab, i) => {
      const row = document.createElement('div');
      row.className = 'tabs-modal-row';
      const isUrl = tab.type === 'url';
      row.innerHTML = `
        <span class="tabs-modal-drag" title="Drag to reorder">${GRIP_ICON}</span>
        <span class="tabs-modal-row-icon">${getTabIconHtml(tab)}</span>
        <span class="tabs-modal-row-label">${esc(tab.label)}</span>
        ${isUrl
          ? `<span class="tabs-modal-row-url" title="${esc(tab.url || '')}">${esc(tab.url || '')}</span>`
          : `<span class="tabs-modal-row-badge">${esc(tab.type)}</span>`}
        <button class="tabs-modal-remove" title="Remove">✕</button>
      `;
      row.draggable = true;

      row.addEventListener('dragstart', e => {
        dragSrcIdx = i;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => row.classList.add('dragging'));
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        listEl.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
        if (dragSrcIdx !== i) row.classList.add('drag-over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        if (dragSrcIdx === -1 || dragSrcIdx === i) return;
        const [moved] = draft.splice(dragSrcIdx, 1);
        draft.splice(i, 0, moved);
        dragSrcIdx = -1;
        renderList();
      });

      row.querySelector('.tabs-modal-remove').addEventListener('click', () => {
        draft.splice(i, 1);
        renderList();
      });

      listEl.appendChild(row);
    });

    updateAddSelect();
  }

  function updateAddBtn() {
    if (addSel.value === 'url') {
      const ready = !!(addLabelIn.value.trim() && addUrlIn.value.trim());
      addBtn.disabled = !ready;
      addBtn.classList.toggle('ready', ready);
    } else {
      addBtn.disabled = false;
      addBtn.classList.add('ready');
    }
  }

  addSel.addEventListener('change', () => {
    if (addSel.value === 'url') urlFields.classList.add('visible');
    else urlFields.classList.remove('visible');
    updateAddBtn();
  });
  addLabelIn.addEventListener('input', updateAddBtn);
  addUrlIn.addEventListener('input', updateAddBtn);

  addBtn.addEventListener('click', () => {
    const type = addSel.value;
    if (type === 'url') {
      const label = addLabelIn.value.trim();
      let url     = addUrlIn.value.trim();
      if (!label || !url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      draft.push({ id: 'url:' + url, type: 'url', label, url });
      addLabelIn.value = '';
      addUrlIn.value   = '';
    } else {
      const base = BUILTIN_DEFAULTS[type];
      const count = draft.filter(t => t.type === type).length;
      const label = count === 0 ? base.label : `${base.label} ${toRoman(count + 1)}`;
      const id    = count === 0 ? base.id : `${base.id}-${count + 1}`;
      draft.push({ id, type, label });
    }
    renderList();
  });

  const ctl = wireModal(modal);

  saveBtn.addEventListener('click', () => {
    // Destroy removed custom views in main
    tabsConfig
      .filter(t => t.type === 'url' && !draft.some(d => d.id === t.id))
      .forEach(t => ipcRenderer.send('destroy-custom-view', t.url));

    tabsConfig = draft;
    localStorage.setItem(LS.tabs, JSON.stringify(tabsConfig));
    renderViewTabs();

    // If active tab was removed, switch to first available
    if (tabsConfig.length && !tabsConfig.find(t => t.id === activeViewTabId)) {
      activateViewTab(tabsConfig[0].id);
    }

    ctl.close();
  });

  cancelBtn.addEventListener('click', ctl.close);

  openEditTabsModal = function() {
    draft = tabsConfig.map(t => ({ ...t }));
    addLabelIn.value = '';
    addUrlIn.value   = '';
    renderList(); // also calls updateAddSelect() → updateAddBtn()
    ctl.open();
  };
})();

// ── MCP Tools modal ───────────────────────────────────────────────
(function initMcpToolsModal() {
  const modal        = document.getElementById('mcp-modal');
  const listEl       = document.getElementById('mcp-modal-list');
  const svcSel       = document.getElementById('mcp-service-select');
  const customFields = document.getElementById('mcp-custom-fields');
  const tokenField   = document.getElementById('mcp-token-field');
  const nameIn       = document.getElementById('mcp-add-name');
  const pkgIn        = document.getElementById('mcp-add-package');
  const envVarIn     = document.getElementById('mcp-add-envvar');
  const tokenIn      = document.getElementById('mcp-add-token-input');
  const tokenHint    = document.getElementById('mcp-token-hint');
  const noTokenInfo  = document.getElementById('mcp-no-token-info');
  const addBtn       = document.getElementById('mcp-add-btn');
  const closeBtn     = document.getElementById('mcp-cancel');
  const restartNotice = document.getElementById('mcp-restart-notice');
  const restartBtn   = document.getElementById('mcp-restart-btn');
  if (!modal) return;

  const connectMsg = document.getElementById('mcp-connect-msg');

  const TOKEN_HINTS = {
    'figma-framelink': 'Generate a Personal Access Token at figma.com → Settings → Security → Personal access tokens',
    'figma-devmode':   'No token. Requires the Figma desktop app running with Dev Mode MCP enabled (Preferences → Enable Dev Mode MCP Server).',
    'github':          'Generate a token at github.com → Settings → Developer settings → Personal access tokens',
    'linear':          'Generate an API key at linear.app → Settings → API',
    'browser':         'No token needed. Launches a Playwright-controlled browser.',
  };
  // Catalog keys that need no token — Connect enabled immediately
  const NO_TOKEN_SERVICES = new Set(['browser', 'figma-devmode']);
  const NO_TOKEN_DESCRIPTIONS = {
    'browser':       'No API key needed — controls a Playwright browser directly.',
    'figma-devmode': 'No API key needed — connects to the Figma desktop app’s local Dev Mode server. Make sure Figma desktop is open with Dev Mode MCP enabled.',
  };

  let agentList = [];   // [{key,label}]
  let servers   = [];   // [{name, agents:{key:status}}]

  const esc = escHtml;

  function agentDots(srv) {
    return agentList.map(a => {
      const st = srv.agents[a.key];
      const cls = st === 'connected' ? 'ok' : st === 'disabled' ? 'warn' : st ? 'on' : 'off';
      const title = st ? `${a.label}: ${st}` : `${a.label}: not added`;
      return `<span class="mcp-agent-dot ${cls}" title="${esc(title)}">${esc(a.label.split(' ')[0])}</span>`;
    }).join('');
  }

  function renderRows() {
    listEl.innerHTML = '';
    if (!servers.length) {
      listEl.innerHTML = '<div class="mcp-status">No MCP servers connected yet.</div>';
      return;
    }
    servers.forEach((srv) => {
      const row = document.createElement('div');
      row.className = 'mcp-list-row';
      row.innerHTML = `
        <span class="mcp-list-name">${esc(srv.name)}</span>
        <span class="mcp-agent-dots">${agentDots(srv)}</span>
        <button class="tabs-modal-remove" title="Disconnect from all agents">✕</button>
      `;
      row.querySelector('.tabs-modal-remove').addEventListener('click', async () => {
        row.querySelector('.tabs-modal-remove').textContent = '…';
        await ipcRenderer.invoke('mcp-disconnect', { serverName: srv.name });
        await loadAndRender();
      });
      listEl.appendChild(row);
    });
  }

  function updateVisibility() {
    const svc       = svcSel.value;
    const custom    = svc === 'custom';
    const noToken   = NO_TOKEN_SERVICES.has(svc);
    const needToken = !!svc && !noToken && !custom;
    customFields.classList.toggle('visible', custom);
    tokenField.classList.toggle('visible', needToken || custom);
    if (tokenHint)   tokenHint.textContent = (svc && TOKEN_HINTS[svc]) || '';
    if (noTokenInfo) {
      noTokenInfo.textContent = noToken ? (NO_TOKEN_DESCRIPTIONS[svc] || '') : '';
      noTokenInfo.classList.toggle('visible', noToken && !!svc);
    }
  }

  function updateConnectBtn() {
    const svc = svcSel.value;
    let ready = false;
    if (NO_TOKEN_SERVICES.has(svc)) {
      ready = true;
    } else if (svc === 'custom') {
      ready = !!(nameIn.value.trim() && pkgIn.value.trim());
    } else if (svc) {
      ready = !!tokenIn.value.trim();
    }
    addBtn.disabled = !ready;
    addBtn.classList.toggle('ready', ready);
  }

  svcSel.addEventListener('change', () => { updateVisibility(); updateConnectBtn(); });
  [nameIn, pkgIn, envVarIn, tokenIn].forEach(el => el.addEventListener('input', updateConnectBtn));
  updateConnectBtn();

  addBtn.addEventListener('click', async () => {
    const svc   = svcSel.value;
    const token = tokenIn.value.trim();
    if (!svc) return;

    addBtn.disabled = true;
    addBtn.textContent = 'Connecting…';
    connectMsg.className = 'mcp-connect-msg';
    connectMsg.textContent = `Adding to ${agentList.map(a => a.label).join(', ') || 'agents'}…`;

    const result = await ipcRenderer.invoke('mcp-connect', {
      catalogKey: svc,
      token,
      custom: svc === 'custom'
        ? { name: nameIn.value.trim(), npxPackage: pkgIn.value.trim(), envVar: envVarIn.value.trim() }
        : undefined,
    });

    addBtn.textContent = 'Connect';

    if (!result || result.error) {
      connectMsg.className = 'mcp-connect-msg err';
      connectMsg.textContent = result?.error || 'Connection failed.';
      updateConnectBtn();
      return;
    }

    const okAgents  = result.results.filter(r => r.ok).map(r => r.label);
    const badAgents = result.results.filter(r => !r.ok);
    if (okAgents.length) {
      connectMsg.className = 'mcp-connect-msg ok';
      connectMsg.textContent = `✓ Added to ${okAgents.join(', ')}.` +
        (badAgents.length ? `  Failed: ${badAgents.map(b => b.label).join(', ')}.` : '');
      restartNotice.classList.add('visible');
    } else {
      connectMsg.className = 'mcp-connect-msg err';
      connectMsg.textContent = `Failed: ${badAgents.map(b => `${b.label} (${b.detail})`).join('; ')}`;
    }

    svcSel.value = ''; tokenIn.value = ''; nameIn.value = ''; pkgIn.value = ''; envVarIn.value = '';
    updateVisibility();
    updateConnectBtn();
    await loadAndRender();
  });

  async function loadAndRender() {
    listEl.innerHTML = '<div class="mcp-status">Checking agents…</div>';
    const status = await ipcRenderer.invoke('mcp-status');
    agentList = status.agents || [];
    servers   = status.servers || [];
    renderRows();
    refreshFigmaTool();   // show/hide the composer Figma button as connections change
  }

  // backdropClose off: a stray click during a long `mcp list` check shouldn't dismiss
  const ctl = wireModal(modal, { backdropClose: false });

  restartBtn.addEventListener('click', () => {
    if (activeId !== null) ipcRenderer.send('pty-restart', { id: activeId });
    ctl.close();
  });

  closeBtn.addEventListener('click', ctl.close);

  openMcpToolsModal = async function() {
    restartNotice.classList.remove('visible');
    connectMsg.textContent = '';
    connectMsg.className = 'mcp-connect-msg';
    svcSel.value = '';
    updateVisibility();
    updateConnectBtn();
    ctl.open();
    await loadAndRender();
  };
})();

// ── Keyboard Shortcuts modal ──────────────────────────────────────
(function initKeyboardShortcutsModal() {
  const modal    = document.getElementById('kb-modal');
  const closeBtn = document.getElementById('kb-close');
  if (!modal) return;

  const ctl = wireModal(modal);
  closeBtn.addEventListener('click', ctl.close);
  openKeyboardShortcutsModal = ctl.open;
})();

// When the user drags the resize handle, the composer textarea height is pinned
// to manualInputHeight (px) and auto-growing is suspended until they reset it.
let manualInputHeight = null;
function autoResize(el) {
  if (el === uiTextarea && manualInputHeight != null) {
    el.style.height = manualInputHeight + 'px';
    return;
  }
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 300) + 'px';
}

// ── Slash command menu ────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/help',          desc: 'Show help and available commands' },
  { cmd: '/clear',         desc: 'Clear conversation history' },
  { cmd: '/compact',       desc: 'Compact conversation (add optional instructions)' },
  { cmd: '/cost',          desc: 'Show token usage and cost for this session' },
  { cmd: '/doctor',        desc: 'Check Claude Code installation health' },
  { cmd: '/exit',          desc: 'Exit Claude Code' },
  { cmd: '/init',          desc: 'Initialize CLAUDE.md in current project' },
  { cmd: '/login',         desc: 'Sign in to Anthropic' },
  { cmd: '/logout',        desc: 'Sign out from Anthropic' },
  { cmd: '/memory',        desc: 'Edit CLAUDE.md memory files' },
  { cmd: '/model',         desc: 'Set or view the AI model' },
  { cmd: '/permissions',   desc: 'Manage tool permissions' },
  { cmd: '/pr_comments',   desc: 'View comments on the current pull request' },
  { cmd: '/release_notes', desc: 'Show Claude Code release notes' },
  { cmd: '/review',        desc: 'Run a code review on recent changes' },
  { cmd: '/status',        desc: 'Show account and billing status' },
  { cmd: '/vim',           desc: 'Toggle vim keybindings mode' },
  { cmd: '/bug',           desc: 'Report a bug to Anthropic' },
];

// ── Saved prompts ─────────────────────────────────────────────────
// Corrupt/half-written localStorage must not throw at module load (that would
// abort the whole renderer script). Parse defensively with a fallback.
function safeParse(raw, fallback) {
  try { const v = JSON.parse(raw); return v == null ? fallback : v; }
  catch (_) { return fallback; }
}
let savedPrompts = safeParse(localStorage.getItem(LS.savedPrompts), []);

function savePromptsToStorage() {
  localStorage.setItem(LS.savedPrompts, JSON.stringify(savedPrompts));
}

const btnSavePrompt = document.getElementById('btn-save-prompt');
const savePromptTag = document.getElementById('save-prompt-tag');
let saveTagTimer    = null;

function updateSaveBtn() {
  btnSavePrompt.classList.toggle('show', uiTextarea.value.length > 0);
}

btnSavePrompt.addEventListener('click', () => {
  const name = uiTextarea.value.split('\n')[0].slice(0, 50).trim() || 'Untitled';
  savedPrompts.push({ id: Date.now(), name, text: uiTextarea.value });
  savePromptsToStorage();
  btnSavePrompt.classList.add('saved');
  savePromptTag.classList.add('show');
  clearTimeout(saveTagTimer);
  saveTagTimer = setTimeout(() => {
    savePromptTag.classList.remove('show');
    btnSavePrompt.classList.remove('saved');
  }, 1500);
});

function showSavedPromptsView() {
  slashMenu.innerHTML = '';
  slashMenu.classList.add('visible');
  slashVisible  = true;
  slashMenuView = 'prompts';
  spFocusIdx    = 0;
  spSubFocus    = 'row';

  const header = document.createElement('div');
  header.className = 'sp-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'sp-back-btn';
  backBtn.textContent = '← Back';
  backBtn.addEventListener('mousedown', e => e.preventDefault());
  backBtn.addEventListener('click', () => showSlashMenu('/'));

  const title = document.createElement('span');
  title.className = 'sp-title';
  title.textContent = savedPrompts.length ? `Saved Prompts (${savedPrompts.length})` : 'Saved Prompts';

  header.appendChild(backBtn);
  header.appendChild(title);
  slashMenu.appendChild(header);

  if (!savedPrompts.length) {
    const empty = document.createElement('div');
    empty.className = 'sp-empty';
    empty.textContent = 'No saved prompts yet. Type a message and click the bookmark icon to save it.';
    slashMenu.appendChild(empty);
    return;
  }

  savedPrompts.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = 'sp-item' + (idx === 0 ? ' focused' : '');

    const num = document.createElement('span');
    num.className = 'sp-item-num';
    num.textContent = idx + 1;

    const name = document.createElement('span');
    name.className = 'sp-item-name';
    name.textContent = p.name;
    name.title = p.text;

    const actions = document.createElement('div');
    actions.className = 'sp-item-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'sp-btn sp-edit';
    editBtn.title = 'Edit prompt';
    editBtn.innerHTML = '&#x270e;';
    editBtn.addEventListener('mousedown', e => e.preventDefault());
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      showSPEditMode(idx);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'sp-btn sp-delete';
    delBtn.title = 'Delete prompt';
    delBtn.innerHTML = '&#x2715;';
    delBtn.addEventListener('mousedown', e => e.preventDefault());
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      savedPrompts = savedPrompts.filter(sp => sp.id !== p.id);
      savePromptsToStorage();
      showSavedPromptsView();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(num);
    item.appendChild(name);
    item.appendChild(actions);

    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', e => {
      if (e.target.closest('.sp-btn')) return;
      useSavedPrompt(p);
    });

    slashMenu.appendChild(item);
  });
  updateSPFocusViz();
}

const slashMenu = document.getElementById('slash-menu');
let slashFocusIdx = 0;
let slashVisible  = false;
let slashMenuView = 'commands'; // 'commands' | 'prompts'
let spFocusIdx    = 0;          // -1 = back button, 0..n-1 = prompt rows
let spSubFocus    = 'row';      // 'row' | 'edit' | 'delete'
let spEditActive  = false;

function getSlashQuery() {
  const val     = uiTextarea.value;
  const pos     = uiTextarea.selectionStart;
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  const line    = val.slice(lineStart, pos);
  return line.startsWith('/') ? line : null;
}

function getSavedPromptsEntry() {
  const count = savedPrompts.length;
  return {
    cmd: '/saved-prompts',
    label: count ? `Saved Prompts (${count})` : 'Saved Prompts',
    desc: 'View and use your saved prompts',
  };
}

function showSlashMenu(query) {
  slashMenuView = 'commands';
  const entry = getSavedPromptsEntry();
  const savedMatches = entry.cmd.startsWith(query);
  const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(query));
  if (!savedMatches && !filtered.length) { hideSlashMenu(); return; }
  const allItems = savedMatches ? [entry, ...filtered] : filtered;
  slashMenu.innerHTML = '';
  allItems.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'slash-item' + (i === 0 ? ' focused' : '');
    item.dataset.cmd = c.cmd;
    const cmd  = document.createElement('span'); cmd.className  = 'slash-cmd';  cmd.textContent = c.label || c.cmd;
    const desc = document.createElement('span'); desc.className = 'slash-desc'; desc.textContent = c.desc;
    item.appendChild(cmd); item.appendChild(desc);
    slashMenu.appendChild(item);
  });
  slashFocusIdx = 0;
  slashMenu.classList.add('visible');
  slashVisible = true;
}

function hideSlashMenu() {
  slashMenu.classList.remove('visible');
  slashVisible  = false;
  slashMenuView = 'commands';
  spFocusIdx    = 0;
  spSubFocus    = 'row';
  spEditActive  = false;
}

function updateSPFocusViz() {
  const items = slashMenu.querySelectorAll('.sp-item');
  items.forEach((el, i) => el.classList.toggle('focused', i === spFocusIdx));
  const backBtn = slashMenu.querySelector('.sp-back-btn');
  if (backBtn) backBtn.classList.toggle('focused', spFocusIdx === -1);
  slashMenu.querySelectorAll('.sp-btn').forEach(b => b.classList.remove('sub-focused'));
  if (spFocusIdx >= 0 && spSubFocus !== 'row') {
    const row = items[spFocusIdx];
    if (row) {
      const btn = row.querySelector(spSubFocus === 'edit' ? '.sp-edit' : '.sp-delete');
      if (btn) btn.classList.add('sub-focused');
    }
  }
}

function moveSPFocus(delta) {
  const items = slashMenu.querySelectorAll('.sp-item');
  spSubFocus = 'row';
  if (delta > 0) {
    if (spFocusIdx === -1) spFocusIdx = 0;
    else if (spFocusIdx < items.length - 1) spFocusIdx++;
  } else {
    if (spFocusIdx === 0) spFocusIdx = -1;
    else if (spFocusIdx > 0) spFocusIdx--;
  }
  updateSPFocusViz();
  if (spFocusIdx >= 0 && items[spFocusIdx]) {
    items[spFocusIdx].scrollIntoView({ block: 'nearest' });
  } else if (spFocusIdx === -1) {
    const backBtn = slashMenu.querySelector('.sp-back-btn');
    if (backBtn) backBtn.scrollIntoView({ block: 'nearest' });
  }
}

function moveSPSubFocus(delta) {
  if (spFocusIdx < 0) return;
  const order = ['row', 'edit', 'delete'];
  spSubFocus = order[(order.indexOf(spSubFocus) + delta + order.length) % order.length];
  updateSPFocusViz();
}

function activateSPFocused() {
  if (spFocusIdx === -1) { showSlashMenu('/'); return; }
  const p = savedPrompts[spFocusIdx];
  if (!p) return;
  if (spSubFocus === 'row')    { useSavedPrompt(p); return; }
  if (spSubFocus === 'edit')   { showSPEditMode(spFocusIdx); return; }
  if (spSubFocus === 'delete') {
    savedPrompts = savedPrompts.filter(sp => sp.id !== p.id);
    savePromptsToStorage();
    spFocusIdx = Math.min(spFocusIdx, savedPrompts.length - 1);
    if (spFocusIdx < 0 && savedPrompts.length) spFocusIdx = 0;
    showSavedPromptsView();
  }
}

function useSavedPrompt(p) {
  hideSlashMenu();
  uiTextarea.value = p.text;
  sendUiMessage();
}

function showSPEditMode(editIdx) {
  const p = savedPrompts[editIdx];
  if (!p) return;
  spEditActive = true;

  const items = slashMenu.querySelectorAll('.sp-item');
  const itemEl = items[editIdx];
  if (!itemEl) return;

  const editor = document.createElement('div');
  editor.className = 'sp-item-editor';

  const ta = document.createElement('textarea');
  ta.className = 'sp-edit-textarea';
  ta.value = p.text;
  ta.rows = 4;
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape')                  { e.preventDefault(); cancelEdit(); }
    if (e.ctrlKey && e.key === 'Enter')      { e.preventDefault(); saveEdit(); }
    e.stopPropagation();
  });

  const actRow = document.createElement('div');
  actRow.className = 'sp-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'sp-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', saveEdit);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'sp-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', cancelEdit);

  function saveEdit() {
    const newText = ta.value.trim();
    if (newText) { savedPrompts[editIdx].text = newText; savePromptsToStorage(); }
    exitEdit();
  }
  function cancelEdit() { exitEdit(); }
  function exitEdit() {
    spEditActive = false;
    showSavedPromptsView();
    uiTextarea.focus();
  }

  actRow.appendChild(saveBtn);
  actRow.appendChild(cancelBtn);
  editor.appendChild(ta);
  editor.appendChild(actRow);
  itemEl.replaceWith(editor);

  requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; });
}

function moveFocus(delta) {
  const items = slashMenu.querySelectorAll('.slash-item');
  if (!items.length) return;
  items[slashFocusIdx].classList.remove('focused');
  slashFocusIdx = (slashFocusIdx + delta + items.length) % items.length;
  items[slashFocusIdx].classList.add('focused');
  items[slashFocusIdx].scrollIntoView({ block: 'nearest' });
}

function commitSlash(cmd) {
  if (cmd === '/saved-prompts') {
    showSavedPromptsView();
    return;
  }
  const val       = uiTextarea.value;
  const pos       = uiTextarea.selectionStart;
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  uiTextarea.value = val.slice(0, lineStart) + cmd + val.slice(pos);
  uiTextarea.selectionStart = uiTextarea.selectionEnd = lineStart + cmd.length;
  hideSlashMenu();
  autoResize(uiTextarea);
  uiTextarea.focus();
}

// Keep focus in textarea when clicking menu items
slashMenu.addEventListener('mousedown', e => e.preventDefault());
slashMenu.addEventListener('click', e => {
  const item = e.target.closest('.slash-item');
  if (item) commitSlash(item.dataset.cmd);
});

uiTextarea.addEventListener('input', () => {
  autoResize(uiTextarea);
  const n = uiTextarea.value.length;
  uiCharCount.textContent = n > 0 ? n + ' chars' : '';
  updateSaveBtn();
  const query = getSlashQuery();
  if (query !== null) showSlashMenu(query); else hideSlashMenu();
});

uiTextarea.addEventListener('keydown', e => {
  // Slash menu navigation takes priority
  if (slashVisible) {
    if (slashMenuView === 'prompts') {
      if (e.key === 'ArrowDown')  { e.preventDefault(); moveSPFocus(1);     return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); moveSPFocus(-1);    return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveSPSubFocus(1);  return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSPSubFocus(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); activateSPFocused(); return; }
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (savedPrompts[idx]) useSavedPrompt(savedPrompts[idx]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
    } else {
      if (e.key === 'ArrowDown')                { e.preventDefault(); moveFocus(1);  return; }
      if (e.key === 'ArrowUp')                  { e.preventDefault(); moveFocus(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const focused = slashMenu.querySelector('.slash-item.focused');
        if (focused) commitSlash(focused.dataset.cmd);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
    }
  }

  // Esc while typing → stop the agent (slash menu already handled above).
  if (e.key === 'Escape') { e.preventDefault(); interruptActiveSession(); return; }

  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUiMessage(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault(); uiTextarea.value = e.key; sendUiMessage(); return;
  }
  // History: arrow up at very start, arrow down at very end
  if (e.key === 'ArrowUp' && uiTextarea.selectionStart === 0 && uiTextarea.selectionEnd === 0 && msgHistory.length) {
    e.preventDefault();
    historyIdx = Math.max(0, historyIdx - 1);
    uiTextarea.value = msgHistory[historyIdx] || '';
    autoResize(uiTextarea);
    return;
  }
  if (e.key === 'ArrowDown' && uiTextarea.selectionEnd === uiTextarea.value.length) {
    e.preventDefault();
    historyIdx = Math.min(msgHistory.length, historyIdx + 1);
    uiTextarea.value = historyIdx < msgHistory.length ? msgHistory[historyIdx] : '';
    autoResize(uiTextarea);
    return;
  }
});

uiTextarea.addEventListener('blur', () => { if (!spEditActive) setTimeout(hideSlashMenu, 120); });

function sendUiMessage() {
  const raw = uiTextarea.value;
  const figma = figmaChips.slice();
  const attach = attachChips.slice();
  if (!raw.trim() && !figma.length && !attach.length) return;

  // A Framelink action can't run without its Figma URL — prompt for it instead of sending.
  const missing = figma.find(f => f.needsUrl && !f.url);
  if (missing) { focusChipUrl(missing.key); return; }

  if (raw.trim()) {
    msgHistory.push(raw);
    if (msgHistory.length > MSG_HISTORY_MAX) msgHistory.shift();
    historyIdx = msgHistory.length;
  }

  // Compose: Figma action instructions (with their URL) first, then the user's
  // free text, then any attached file/folder paths.
  let body = raw;
  if (figma.length) {
    const instr = figma
      .map(f => f.needsUrl && f.url ? `${f.instruction}\n\nFigma URL: ${f.url}` : f.instruction)
      .join('\n\n');
    body = instr + (raw.trim() ? '\n\n' + raw : '');
  }
  // The agent gets every attached path in the sent text…
  const attachText = attach.map(a => a.path).join('\n');
  if (attach.length) body = (body.trim() ? body + '\n\n' : '') + attachText;

  // …but in the chat, image attachments show as thumbnails (not their path).
  const images       = attach.filter(a => a.kind === 'file' && isChatImage(a.path)).map(a => a.path);
  const shownAttach  = attach.filter(a => !(a.kind === 'file' && isChatImage(a.path)));
  const shownAttachText = shownAttach.map(a => a.path).join('\n');

  // What the user sees in the chat (chip titles / non-image paths + their text)
  let display = figma.length
    ? figma.map(f => `[Figma: ${f.title}]`).join(' ') + (raw.trim() ? '\n' + raw : '')
    : raw;
  if (shownAttachText) display = (display.trim() ? display + '\n' : '') + shownAttachText;

  const text = (sbConfig && sbConfig.autoInject)
    ? sbContextText(sbConfig) + '\n\n' + body
    : body;
  routeToActiveSession(text, display, images, { figma, attach });
  clearFigmaChips();
  clearAttachChips();
  uiTextarea.value = '';
  uiTextarea.style.height = '';
  uiCharCount.textContent = '';
  updateSaveBtn();
}

document.getElementById('btn-ui-send').addEventListener('click', sendUiMessage);

// Code block wrap
document.getElementById('btn-ui-code').addEventListener('click', () => {
  const start = uiTextarea.selectionStart;
  const end   = uiTextarea.selectionEnd;
  const val   = uiTextarea.value;
  const sel   = val.slice(start, end);
  const multi = sel.includes('\n');
  const wrapped = multi ? '```\n' + sel + '\n```' : '`' + sel + '`';
  uiTextarea.value = val.slice(0, start) + wrapped + val.slice(end);
  uiTextarea.selectionStart = start + (multi ? 4 : 1);
  uiTextarea.selectionEnd   = start + (multi ? 4 : 1) + sel.length;
  autoResize(uiTextarea);
  uiTextarea.focus();
});

// File attach — opens native file dialog, adds the paths as chips
document.getElementById('btn-ui-attach').addEventListener('click', async () => {
  const paths = await ipcRenderer.invoke('show-file-dialog');
  if (paths && paths.length) addAttachChips(paths, 'file');
});

// Folder attach — opens native folder dialog, adds the path as a chip
document.getElementById('btn-ui-attach-folder').addEventListener('click', async () => {
  const dir = await ipcRenderer.invoke('show-folder-dialog');
  if (dir) addAttachChips([dir], 'folder');
});

// Drag the corner handle to make the composer taller/shorter (up = taller).
// Double-click resets to automatic content-based sizing.
(function initInputResize() {
  const handle = document.getElementById('btn-ui-resize');
  const area   = document.getElementById('ui-input-area');
  if (!handle || !area) return;
  let startY = 0, startH = 0, dragging = false;

  function onMove(e) {
    if (!dragging) return;
    const delta = startY - e.clientY;                       // up → positive → taller
    const max   = Math.round(window.innerHeight * 0.7);
    manualInputHeight = Math.max(72, Math.min(startH + delta, max));
    uiTextarea.style.height = manualInputHeight + 'px';
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = uiTextarea.getBoundingClientRect().height;
    area.style.maxHeight = 'none';   // lift the 42% cap while manually sized
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });
  handle.addEventListener('dblclick', () => {
    manualInputHeight = null;
    area.style.maxHeight = '';
    autoResize(uiTextarea);
  });
})();

let updateComponentPickerBtn = null; // set by component picker IIFE

// ── Storybook panel ──────────────────────────────────────────────
let sbConfig = safeParse(localStorage.getItem(LS.storybook), null);

function sbContextText(cfg) {
  return `[Design System] Before making any UI changes, reference the Storybook at ${cfg.value}. Use its design tokens, component APIs, and visual styles to ensure consistency with the existing design system.`;
}

function renderSbConnected() {
  document.getElementById('sb-setup').style.display     = 'none';
  document.getElementById('sb-connected').style.display = 'flex';
  document.getElementById('sb-conn-val').textContent    = sbConfig.value;
  document.getElementById('sb-auto-conn').checked       = sbConfig.autoInject;
  document.getElementById('sb-preview-text').textContent = sbContextText(sbConfig);
  document.getElementById('sb-preview').style.display = sbConfig.autoInject ? '' : 'none';
  const filesEl = document.getElementById('sb-memory-files');
  if (filesEl) {
    filesEl.textContent = `${sbConfig.projectDir || 'Home folder (global)'}  —  CLAUDE.md · AGENTS.md · GEMINI.md`;
  }
}

function renderSbSetup() {
  document.getElementById('sb-setup').style.display     = 'flex';
  document.getElementById('sb-connected').style.display = 'none';
}

function sbNotifyMain() {
  if (sbConfig) ipcRenderer.send('storybook-load-url', sbConfig.value);
  else          ipcRenderer.send('storybook-disconnect');
}

// Init — restore live view if URL was previously connected
ipcRenderer.send('set-project-dir', { dir: (sbConfig && sbConfig.projectDir) || '' });
if (sbConfig) {
  if (sbConfig.projectDir) document.getElementById('sb-folder').value = sbConfig.projectDir;
  renderSbConnected();
  sbNotifyMain();
} else renderSbSetup();

document.getElementById('sb-folder-pick').addEventListener('click', async () => {
  const dir = await ipcRenderer.invoke('show-folder-dialog');
  if (dir) document.getElementById('sb-folder').value = dir;
});

document.getElementById('sb-connect').addEventListener('click', async () => {
  const url  = document.getElementById('sb-url').value.trim();
  const auto = document.getElementById('sb-auto').checked;
  const dir  = document.getElementById('sb-folder').value.trim();
  if (!url) {
    document.getElementById('sb-url').focus();
    document.getElementById('sb-url').style.borderColor = '#f44747';
    setTimeout(() => document.getElementById('sb-url').style.borderColor = '', 1500);
    return;
  }
  sbConfig = { value: url, autoInject: auto, projectDir: dir };
  localStorage.setItem(LS.storybook, JSON.stringify(sbConfig));
  // Point future sessions at the project dir, then write the memory files there
  ipcRenderer.send('set-project-dir', { dir });
  await ipcRenderer.invoke('storybook-write-memory', { url });
  renderSbConnected();
  sbNotifyMain();
  updateComponentPickerBtn?.();
});

document.getElementById('sb-disconnect').addEventListener('click', async () => {
  await ipcRenderer.invoke('storybook-clear-memory');   // remove the managed block first
  sbConfig = null;
  localStorage.removeItem(LS.storybook);
  document.getElementById('sb-url').value = '';
  document.getElementById('sb-folder').value = '';
  ipcRenderer.send('set-project-dir', { dir: '' });
  renderSbSetup();
  ipcRenderer.send('storybook-disconnect');
  updateComponentPickerBtn?.();
});

document.getElementById('sb-auto-conn').addEventListener('change', e => {
  if (!sbConfig) return;
  sbConfig.autoInject = e.target.checked;
  localStorage.setItem(LS.storybook, JSON.stringify(sbConfig));
  document.getElementById('sb-preview').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('sb-url').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sb-connect').click(); }
  e.stopPropagation();
});

// ── Storybook component picker panel (left column) ───────────────
// Ported from the old separate component-picker window. The renderer already
// has the target + Storybook URL, so it drives the panel directly: fetch
// index.json, list/search/preview components, and route the insert message to
// chat. The on-page "selected location" highlight still goes through main.
let openComponentPanel = null;
(function initComponentPanel() {
  const panel        = document.getElementById('component-panel');
  if (!panel) return;
  const locLink      = document.getElementById('comp-loc-link');
  const searchIn     = document.getElementById('comp-search');
  const listEl       = document.getElementById('comp-list');
  const instr        = document.getElementById('comp-instructions');
  const insertBtn    = document.getElementById('comp-insert');
  const cancelBtn    = document.getElementById('comp-cancel');

  let sbUrl = '', allStories = [], target = null, selected = null, openDrawer = null;

  function nodeGet(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? require('https') : require('http');
      mod.get(url, res => { let raw = ''; res.on('data', c => raw += c); res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } }); }).on('error', reject);
    });
  }
  function targetSig(t) { return '<' + t.tag + (t.id ? '#' + t.id : '') + ((t.classes && t.classes[0]) ? '.' + t.classes[0] : '') + '>'; }

  function chooseStory(story, drawerEl) {
    selected = story;
    listEl.querySelectorAll('.comp-item').forEach(r => r.classList.remove('selected'));
    drawerEl.classList.add('selected');
    insertBtn.disabled = false;
  }
  function collapseOpen() {
    if (!openDrawer) return;
    openDrawer.el.classList.remove('open');
    const c = openDrawer.el.querySelector('.comp-caret'); if (c) c.classList.remove('open');
    openDrawer.body.innerHTML = '';   // free the iframe
    openDrawer.body.hidden = true;
    openDrawer = null;
  }
  function expand(story, drawerEl, body, caret) {
    collapseOpen();   // accordion — one preview at a time
    body.hidden = false;
    body.innerHTML = '';
    const cap = document.createElement('div'); cap.className = 'comp-preview-cap'; cap.textContent = story.title + '  /  ' + story.name;
    const frame = document.createElement('iframe'); frame.className = 'comp-preview-frame';
    const load = document.createElement('div'); load.className = 'comp-preview-loading'; load.textContent = 'Loading preview…';
    frame.addEventListener('load', () => { load.style.display = 'none'; });
    frame.src = `${sbUrl}/iframe.html?id=${story.id}&viewMode=story`;
    body.append(cap, frame, load);
    drawerEl.classList.add('open');
    if (caret) caret.classList.add('open');
    openDrawer = { el: drawerEl, body };
  }
  function renderList(query) {
    openDrawer = null;
    const q = (query || '').toLowerCase();
    const filtered = q ? allStories.filter(s => s.title.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : allStories;
    if (!filtered.length) { listEl.innerHTML = '<div class="comp-loading">No components match.</div>'; return; }
    listEl.innerHTML = '';
    filtered.slice(0, 200).forEach(story => {
      const drawer = document.createElement('div');
      drawer.className = 'comp-item' + (selected && selected.id === story.id ? ' selected' : '');
      const head = document.createElement('div'); head.className = 'comp-item-head';
      const caret = document.createElement('span'); caret.className = 'comp-caret'; caret.textContent = '▶';
      const main = document.createElement('div'); main.className = 'comp-item-main';
      const t = document.createElement('span'); t.className = 'comp-item-title'; t.textContent = story.title;
      const n = document.createElement('span'); n.className = 'comp-item-name'; n.textContent = story.name;
      main.append(t, n);
      head.append(caret, main);
      const body = document.createElement('div'); body.className = 'comp-item-body'; body.hidden = true;
      drawer.append(head, body);
      head.addEventListener('click', () => {
        chooseStory(story, drawer);
        if (drawer.classList.contains('open')) collapseOpen();
        else expand(story, drawer, body, caret);
      });
      listEl.appendChild(drawer);
    });
  }

  searchIn.addEventListener('input', () => renderList(searchIn.value));
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = listEl.querySelector('.comp-item-head'); if (first) first.click(); } });
  locLink.addEventListener('mouseenter', () => { if (target && target.selector) ipcRenderer.send('cp-highlight-target', { selector: target.selector }); });
  locLink.addEventListener('mouseleave', () => ipcRenderer.send('cp-clear-target-highlight'));

  async function doInsert() {
    if (!selected) return;
    const instructions = instr.value.trim();
    const storyUrl = sbUrl + '/?path=/story/' + selected.id;
    let argsLine = '';
    try {
      const detail = await nodeGet(sbUrl + '/stories/' + selected.id + '.json');
      if (detail.args && Object.keys(detail.args).length) argsLine = '\nDefault args: ' + JSON.stringify(detail.args);
    } catch (_) {}
    const t = target;
    const targetDesc = t
      ? '\nTarget element: ' + targetSig(t) + (t.text ? ` ("${t.text.slice(0, 60)}")` : '') + (t.selector ? '\nSelector: ' + t.selector : '')
      : '';
    const msg = [
      `[Component Reference] Use the Storybook component "${selected.title} / ${selected.name}" as a reference for this change.`,
      'Story: ' + storyUrl, argsLine, targetDesc,
      instructions ? '\nInstructions: ' + instructions : '',
    ].filter(Boolean).join('\n');
    routeToActiveSession(msg);
    close();
  }
  function close() {
    ipcRenderer.send('cp-clear-target-highlight');
    collapseOpen();
    panel.hidden = true;
    listEl.innerHTML = ''; instr.value = ''; searchIn.value = '';
    selected = null; allStories = []; target = null;
  }

  insertBtn.addEventListener('click', doInsert);
  cancelBtn.addEventListener('click', close);
  instr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doInsert(); } });
  document.addEventListener('keydown', (e) => {
    if (!panel.hidden && e.key === 'Escape' && document.activeElement !== instr && document.activeElement !== searchIn) { e.preventDefault(); close(); }
  });

  openComponentPanel = async function(tgt, url) {
    clearPickMode();
    sbUrl = (url || '').replace(/\/$/, '');
    target = tgt; selected = null; openDrawer = null;
    insertBtn.disabled = true;
    instr.value = ''; searchIn.value = '';
    const sig = targetSig(tgt);
    locLink.textContent = sig + (tgt.text ? ` — "${tgt.text.slice(0, 40)}${tgt.text.length > 40 ? '…' : ''}"` : '');
    locLink.title = sig + (tgt.selector ? '  ·  ' + tgt.selector : '');
    listEl.innerHTML = '<div class="comp-loading">Loading components…</div>';
    panel.hidden = false;
    try {
      const data = await nodeGet(sbUrl + '/index.json');
      allStories = Object.values(data.entries || {}).filter(e => e.type === 'story');
      renderList('');
      setTimeout(() => searchIn.focus(), 50);
    } catch (_) {
      listEl.innerHTML = `<div class="comp-loading comp-error">Failed to load components from ${sbUrl}</div>`;
    }
  };
})();

// ── Component picker ─────────────────────────────────────────────
(function initComponentPicker() {
  const btn = document.getElementById('btn-pick-component');
  if (!btn) return;

  let pickActive = false;

  updateComponentPickerBtn = function() {
    btn.disabled = !sbConfig;
    btn.title = sbConfig
      ? 'Click element on page to pick Storybook component'
      : 'Connect a Storybook to use component picker';
  };
  updateComponentPickerBtn();

  btn.addEventListener('click', () => {
    if (!sbConfig) return;
    if (pickActive) {
      // 'pick-cancel' dispatches Escape into the page so the click-capture
      // overlay actually tears down (sending 'pick-cancelled' did nothing —
      // that's a main→renderer event with no ipcMain handler).
      ipcRenderer.send('pick-cancel');
      pickActive = false;
      clearPickMode();
      return;
    }
    pickActive = true;
    pickMode = 'component';   // lets the global Escape handler cancel this mode too
    btn.classList.add('active');
    ipcRenderer.send('pick-component');
  });

  ipcRenderer.on('pick-cancelled', () => { pickActive = false; });

  ipcRenderer.on('pick-component-result', (_, target) => {
    pickActive = false;
    if (openComponentPanel && sbConfig) openComponentPanel(target, sbConfig.value);
  });
})();

// ── Onboarding (setup checklist + tools tour) ─────────────────────
let openOnboarding = null;
(function initOnboarding() {
  const modal   = document.getElementById('onboarding');
  const stepsEl = document.getElementById('onb-steps');
  const optEl   = document.getElementById('onb-optional');
  const toolsEl = document.getElementById('onb-tools-grid');
  if (!modal) return;

  const ONB_STEPS = [
    { id: 'wsl', detect: 'wsl', manual: true, title: 'WSL 2 + Ubuntu',
      desc: 'The Linux environment Cathode runs your agents in. One-time — needs admin & a reboot.',
      cmd: 'wsl --install',
      manualHtml: 'Open <b>Windows PowerShell as Administrator</b>, run the command below, then <b>reboot</b>. After Ubuntu finishes its first-time setup, come back and press <b>Re-check</b>.' },
    { id: 'node', detect: 'node', title: 'Node.js',
      desc: 'Runtime for Claude Code and MCP servers (installs via nvm — no admin needed).',
      cmd: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts' },
    { id: 'claude', detect: 'claude', title: 'Claude Code',
      desc: "Anthropic's coding agent CLI — the default agent.",
      cmd: 'npm install -g @anthropic-ai/claude-code' },
    { id: 'auth', detect: 'auth', auth: true, title: 'Sign in to Claude',
      desc: 'Authenticate with your Anthropic account or an API key so the agent can run.' },
  ];

  const AUDIT_ICON = '<svg viewBox="0 0 18 18" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M14.25 11.75V14.25C14.25 15.355 13.355 16.25 12.25 16.25H5.75C4.645 16.25 3.75 15.355 3.75 14.25V12.25"/><path d="M3.75 6.25V3.75C3.75 2.645 4.645 1.75 5.75 1.75H12.25C13.355 1.75 14.25 2.645 14.25 3.75V5.75"/><path d="M1.75 9.25H5.51C5.95 9.25 6.338 8.963 6.466 8.542L7.465 5.272C7.514 5.111 7.741 5.109 7.793 5.269L10.207 12.729C10.259 12.889 10.486 12.887 10.535 12.726L11.534 9.456C11.662 9.035 12.051 8.748 12.49 8.748H16.25"/></svg>';
  const EYE_ICON = eyeIcon(14);

  // Each tool: name, blurb, and `sel` = the real element to highlight on hover
  // (its icon is also cloned from that element so the cards match the app).
  const TOOL_SECTIONS = [
    { title: 'Workspace', tools: [
      { n: 'Working File', d: 'Target a live site or local dev server to inspect & edit with your agent.', sel: '.view-tab[data-view="project"]' },
      { n: 'Storybook', d: 'Pick a design-system component to insert at a targeted location on the page.', sel: '.view-tab[data-view="storybook"]' },
      { n: 'Usage', d: 'Context-window fill and your 5-hour / weekly Claude limits as live gauges.', sel: '#btn-usage' },
    ]},
    { title: 'Toolbar tools', tools: PAGE_TOOLS.filter(t => t.desc).map(t => ({ n: t.label, d: t.desc + ' (' + accelOf(t) + ').', sel: '#' + t.id })) },
    { title: 'Panel controls', tools: [
      { n: 'Audit', d: 'Run a code audit — pick an audit type from the dropdown.', sel: '#btn-audit', icon: AUDIT_ICON },
      { n: 'Chat / Terminal', d: 'Toggle a Claude session between chat view and the raw terminal.', sel: '#session-view-toggle' },
      { n: 'Inspect (DevTools)', d: 'Open the embedded DevTools panel for the page.', sel: '#btn-devtools' },
    ]},
  ];

  const els = {};

  function setState(step, state, badge) {
    const e = els[step.id];
    if (!e) return;
    e.root.className = 'onb-step ' + state;
    e.badge.textContent = badge;
  }

  async function detect(step) {
    if (step.detect === 'wsl')  return ipcRenderer.invoke('check-wsl');
    if (step.detect === 'auth') return ipcRenderer.invoke('check-claude-auth');
    return ipcRenderer.invoke('check-model', { command: step.detect });
  }

  async function recheck(step) {
    setState(step, 'checking', 'Checking…');
    const ok = await detect(step);
    setState(step, ok ? 'ok' : 'missing', ok ? 'Installed' : 'Missing');
    const e = els[step.id];
    if (e && e.installBtn) e.installBtn.disabled = false;
  }

  function runInstall(step) {
    const e = els[step.id];
    setState(step, 'running', 'Installing…');
    e.installBtn.disabled = true;
    e.log.classList.add('visible');
    e.log.textContent = '$ ' + step.cmd + '\n\n';
    ipcRenderer.send('onboarding-run', { id: step.id, command: step.cmd });
  }

  ipcRenderer.on('onboarding-output', (_, { id, data }) => {
    const e = els[id];
    if (e) { e.log.textContent += data; e.log.scrollTop = e.log.scrollHeight; }
  });
  ipcRenderer.on('onboarding-done', (_, { id, code }) => {
    const e = els[id];
    if (e) e.log.textContent += `\n[finished · exit ${code}]\n`;
    const step = ONB_STEPS.find(s => s.id === id) || ONB_STEPS_OPT.find(s => s.id === id);
    if (step) recheck(step);
  });

  const esc = escHtml;

  function renderSteps() {
    stepsEl.innerHTML = '';
    ONB_STEPS.forEach((step, i) => {
      const root = document.createElement('div');
      root.className = 'onb-step checking';
      root.innerHTML = `
        <div class="onb-step-row">
          <span class="onb-step-icon">${i + 1}</span>
          <div class="onb-step-main">
            <div class="onb-step-title">${step.title} <span class="onb-step-badge">Checking…</span></div>
            <div class="onb-step-desc">${step.desc}</div>
          </div>
          <div class="onb-step-actions"></div>
        </div>
        <div class="onb-step-extra"></div>`;
      const actions = root.querySelector('.onb-step-actions');
      const extra   = root.querySelector('.onb-step-extra');
      const badge   = root.querySelector('.onb-step-badge');

      const recheckBtn = mkBtn('Re-check', '', () => recheck(step));

      let installBtn = null, log = null;
      if (step.manual) {
        extra.innerHTML = `<div class="onb-manual">${step.manualHtml}</div>
          <div class="onb-cmd"><code>${esc(step.cmd)}</code></div>`;
        const cmdRow = extra.querySelector('.onb-cmd');
        cmdRow.appendChild(mkBtn('Copy', 'primary', () => navigator.clipboard.writeText(step.cmd)));
        actions.appendChild(recheckBtn);
      } else if (step.auth) {
        installBtn = mkBtn('Open authentication', 'primary', () => openAuthModal());
        actions.appendChild(installBtn);
        actions.appendChild(recheckBtn);
      } else {
        log = document.createElement('div');
        log.className = 'onb-log';
        extra.appendChild(log);
        installBtn = mkBtn('Install', 'primary', () => runInstall(step));
        actions.appendChild(installBtn);
        actions.appendChild(recheckBtn);
      }

      stepsEl.appendChild(root);
      els[step.id] = { root, badge, installBtn, log: log || document.createElement('div') };
    });
  }

  function renderOptional() {
    optEl.innerHTML = '';
    (typeof AVAILABLE_MODELS !== 'undefined' ? AVAILABLE_MODELS : []).forEach(m => {
      const root = document.createElement('div');
      root.className = 'onb-step checking';
      root.innerHTML = `
        <div class="onb-step-row">
          <span class="onb-step-icon">+</span>
          <div class="onb-step-main">
            <div class="onb-step-title">${m.name} <span class="onb-step-badge">Checking…</span></div>
            <div class="onb-step-desc">${esc(m.desc || '')}</div>
          </div>
          <div class="onb-step-actions"></div>
        </div>
        <div class="onb-step-extra"></div>`;
      const actions = root.querySelector('.onb-step-actions');
      const extra   = root.querySelector('.onb-step-extra');
      const badge   = root.querySelector('.onb-step-badge');
      const log = document.createElement('div'); log.className = 'onb-log'; extra.appendChild(log);
      const step = { id: 'opt-' + m.id, detect: m.command, cmd: m.install };
      const installBtn = mkBtn('Install', 'primary', () => runInstall(step));
      actions.appendChild(installBtn);
      actions.appendChild(mkBtn('Re-check', '', () => recheck(step)));
      optEl.appendChild(root);
      els[step.id] = { root, badge, installBtn, log };
      ONB_STEPS_OPT.push(step);
    });
  }

  function iconFor(tool) {
    if (tool.icon) return tool.icon;
    const svg = document.querySelector(tool.sel + ' svg, ' + tool.sel + ' img');
    return svg ? svg.outerHTML : '<span style="width:8px;height:8px;border-radius:50%;background:currentColor;display:block"></span>';
  }

  // ── Hover-to-locate: dim the panel and ring the real element ──────
  let ring = null;
  function locate(sel) {
    const el = sel && document.querySelector(sel);
    if (!el) { clearLocate(); return; }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { clearLocate(); return; }  // hidden right now
    modal.classList.add('locating');
    if (!ring) { ring = document.createElement('div'); ring.id = 'onb-locate-ring'; document.body.appendChild(ring); }
    ring.style.left   = (r.left - 6) + 'px';
    ring.style.top    = (r.top - 6) + 'px';
    ring.style.width  = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';
    ring.classList.add('show');
  }
  function clearLocate() {
    modal.classList.remove('locating');
    if (ring) ring.classList.remove('show');
  }

  function renderTools() {
    toolsEl.innerHTML = '';
    TOOL_SECTIONS.forEach(section => {
      const sec = document.createElement('div');
      sec.className = 'onb-tool-section';
      const head = document.createElement('div');
      head.className = 'onb-tool-section-head';
      head.textContent = section.title;
      sec.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'onb-tool-cards';
      section.tools.forEach(t => {
        const card = document.createElement('div');
        card.className = 'onb-tool';
        card.innerHTML = `<div class="onb-tool-icon">${iconFor(t)}</div>` +
          `<div class="onb-tool-main"><div class="onb-tool-name"></div><div class="onb-tool-desc"></div></div>` +
          `<button class="onb-tool-eye" title="Show where this is on screen">${EYE_ICON}</button>`;
        card.querySelector('.onb-tool-name').textContent = t.n;
        card.querySelector('.onb-tool-desc').textContent = t.d;
        // Locate only when hovering the eye — not the whole card
        const eye = card.querySelector('.onb-tool-eye');
        eye.addEventListener('mouseenter', () => locate(t.sel));
        eye.addEventListener('mouseleave', clearLocate);
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      toolsEl.appendChild(sec);
    });
  }

  function mkBtn(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'onb-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  const ONB_STEPS_OPT = [];

  function detectAll() {
    return Promise.all([...ONB_STEPS, ...ONB_STEPS_OPT].map(recheck));
  }

  // Tabs
  modal.querySelectorAll('.onb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      clearLocate();
      modal.querySelectorAll('.onb-tab').forEach(t => t.classList.toggle('active', t === tab));
      modal.classList.toggle('tab-tools', tab.dataset.tab === 'tools');
      document.getElementById('onb-setup').style.display = tab.dataset.tab === 'setup' ? '' : 'none';
      document.getElementById('onb-tools').style.display = tab.dataset.tab === 'tools' ? '' : 'none';
    });
  });

  function close() {
    clearLocate();
    modal.classList.remove('open');
    ipcRenderer.send('onboarding-cancel');
    localStorage.setItem(LS.onboarded, '1');
  }
  document.getElementById('onb-close').addEventListener('click', close);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

  let built = false;
  openOnboarding = function() {
    if (!built) { renderSteps(); renderOptional(); renderTools(); built = true; }
    modal.classList.add('open');
    detectAll();
  };

  // First run
  if (!localStorage.getItem(LS.onboarded)) {
    setTimeout(() => openOnboarding(), 400);
  }
})();

// ── Code tab (Monaco read-only project viewer) ────────────────────
(function initCodeTab() {
  const emptyEl    = document.getElementById('code-empty');
  const mainEl     = document.getElementById('code-main');
  const treeEl     = document.getElementById('code-tree');
  const rootNameEl = document.getElementById('code-root-name');
  const pathEl     = document.getElementById('code-file-path');
  const welcomeEl  = document.getElementById('code-welcome');
  const editorEl   = document.getElementById('code-editor');
  const openBtn    = document.getElementById('code-open-folder');
  const refreshBtn = document.getElementById('code-refresh');
  const changeBtn  = document.getElementById('code-change-folder');
  if (!treeEl) return;

  let projectDir = '', monaco = null, editor = null, currentModel = null;
  let activeFileEl = null, firstActivation = true;
  let openRel = null, openName = null, openMtime = 0;
  const expanded = new Set();    // rel paths of expanded dirs (preserved across refreshes)
  const dirMtimes = new Map();   // rel dir -> last-seen mtimeMs (structural-change baseline)
  let pollTimer = null, polling = false, flashTimer = null;
  const updatedEl = document.getElementById('code-updated');

  const EXT_LANG = {
    js:'javascript', jsx:'javascript', mjs:'javascript', cjs:'javascript',
    ts:'typescript', tsx:'typescript', json:'json', jsonc:'json',
    html:'html', htm:'html', vue:'html', svelte:'html',
    css:'css', scss:'scss', sass:'scss', less:'less',
    md:'markdown', markdown:'markdown', py:'python', rb:'ruby', go:'go', rs:'rust',
    java:'java', c:'c', h:'c', cpp:'cpp', cc:'cpp', cxx:'cpp', hpp:'cpp', hh:'cpp',
    cs:'csharp', php:'php', sh:'shell', bash:'shell', zsh:'shell',
    yml:'yaml', yaml:'yaml', xml:'xml', svg:'xml', sql:'sql',
    toml:'ini', ini:'ini', conf:'ini', lua:'lua', swift:'swift', kt:'kotlin',
    dart:'dart', r:'r', pl:'perl', ps1:'powershell', bat:'bat', graphql:'graphql', gql:'graphql',
  };
  function langFor(name) {
    const base = name.toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
    if (base === 'makefile') return 'plaintext';
    const ext = base.includes('.') ? base.split('.').pop() : '';
    return EXT_LANG[ext] || 'plaintext';
  }
  function basename(p) {
    const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  const CHEV = chevronRightIcon(12);
  const FOLDER = `<svg class="code-ico" viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 5.25c0-.69.56-1.25 1.25-1.25h2.4c.4 0 .78.19 1.02.51l.66.88h5.92c.69 0 1.25.56 1.25 1.25v6.36c0 .69-.56 1.25-1.25 1.25H4c-.69 0-1.25-.56-1.25-1.25V5.25Z"/></svg>`;
  const FILE = `<svg class="code-ico" viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.25 1.75H5c-.69 0-1.25.56-1.25 1.25v12c0 .69.56 1.25 1.25 1.25h8c.69 0 1.25-.56 1.25-1.25V5.75l-4-4Z"/><path d="M10 1.9V6h4.1"/></svg>`;

  function loadMonaco() {
    return new Promise(resolve => {
      if (monaco) return resolve(monaco);
      if (!window.__amdRequire) return resolve(null);
      window.__amdRequire(['vs/editor/editor.main'], () => { monaco = window.monaco; resolve(monaco); });
    });
  }
  async function ensureEditor() {
    await loadMonaco();
    if (!monaco) return null;
    if (!editor) {
      editor = monaco.editor.create(editorEl, {
        value: '', language: 'plaintext', readOnly: true, theme: 'vs-dark',
        automaticLayout: true, fontSize: 12.5, lineHeight: 18,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        minimap: { enabled: true }, scrollBeyondLastLine: false, renderWhitespace: 'none',
      });
    }
    return editor;
  }

  function markActive(el) {
    if (activeFileEl) activeFileEl.classList.remove('active');
    activeFileEl = el; if (el) el.classList.add('active');
  }
  function showMessage(rel, msg) {
    pathEl.textContent = rel || 'No file selected';
    welcomeEl.querySelector('span').textContent = msg;
    welcomeEl.style.display = 'flex';
    editorEl.style.display = 'none';
  }

  function flashUpdated() {
    if (!updatedEl) return;
    updatedEl.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => updatedEl.classList.remove('show'), 1400);
  }

  async function showFile(rel, name, el) {
    markActive(el);
    openRel = rel; openName = name; openMtime = 0;
    pathEl.textContent = rel;
    const res = await ipcRenderer.invoke('code-read', { rel });
    if (!res || res.error)  { openRel = null; return showMessage(rel, res?.error || 'Could not open file'); }
    if (res.tooLarge)       { openRel = null; return showMessage(rel, 'File too large to preview (over 2 MB)'); }
    if (res.binary)         { openRel = null; return showMessage(rel, 'Binary file — preview unavailable'); }
    openMtime = res.mtimeMs || 0;
    welcomeEl.style.display = 'none';
    editorEl.style.display = 'block';
    const ed = await ensureEditor();
    if (ed) {
      const old = currentModel;
      currentModel = monaco.editor.createModel(res.content, langFor(name));
      ed.setModel(currentModel);
      ed.setScrollPosition({ scrollTop: 0 });
      if (old) old.dispose();
      requestAnimationFrame(() => ed.layout());
    }
  }

  // Re-read the open file in place when it changes on disk, preserving scroll/cursor.
  async function reloadOpenFile() {
    if (!openRel || !editor || !monaco) return;
    const rel = openRel;
    const res = await ipcRenderer.invoke('code-read', { rel });
    if (rel !== openRel) return;   // user switched files mid-read
    if (!res || res.error) { showMessage(rel, res?.error || 'File no longer available'); openRel = null; return; }
    if (res.binary || res.tooLarge) return;
    openMtime = res.mtimeMs || openMtime;
    const view = editor.saveViewState();
    const lang = currentModel ? currentModel.getLanguageId() : langFor(openName);
    const old = currentModel;
    currentModel = monaco.editor.createModel(res.content, lang);
    editor.setModel(currentModel);
    if (view) editor.restoreViewState(view);
    if (old) old.dispose();
    flashUpdated();
  }

  async function buildLevel(parentEl, rel, depth) {
    const res = await ipcRenderer.invoke('code-list', { rel });
    const entries = (res && res.entries) || [];
    for (const entry of entries) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const isDir = entry.type === 'dir';
      const row = document.createElement('div');
      row.className = 'code-row code-' + entry.type + (entry.ignored ? ' code-ignored' : '');
      row.style.paddingLeft = (8 + depth * 13) + 'px';
      row.innerHTML = (isDir ? `<span class="code-chev">${CHEV}</span>${FOLDER}`
                             : `<span class="code-chev"></span>${FILE}`)
                    + `<span class="code-row-name"></span>`;
      row.querySelector('.code-row-name').textContent = entry.name;
      parentEl.appendChild(row);
      if (isDir) {
        const kids = document.createElement('div');
        kids.className = 'code-children';
        kids.style.display = 'none';
        parentEl.appendChild(kids);
        let loaded = false;
        const setOpen = async (open) => {
          if (open) {
            row.classList.add('expanded'); kids.style.display = 'block'; expanded.add(childRel);
            if (!loaded) { loaded = true; await buildLevel(kids, childRel, depth + 1); }
          } else {
            row.classList.remove('expanded'); kids.style.display = 'none'; expanded.delete(childRel);
          }
        };
        row.addEventListener('click', () => setOpen(kids.style.display === 'none'));
        if (expanded.has(childRel)) await setOpen(true);   // restore expansion on rebuild
      } else {
        row.addEventListener('click', () => showFile(childRel, entry.name, row));
        if (openRel === childRel) markActive(row);
      }
    }
  }

  // Rebuild the tree, preserving expansion state and tree scroll position.
  async function buildTree() {
    const scrollTop = treeEl.scrollTop;
    treeEl.innerHTML = '';
    await buildLevel(treeEl, '', 0);
    if (!treeEl.children.length) treeEl.innerHTML = '<div class="code-tree-note">Empty folder</div>';
    treeEl.scrollTop = scrollTop;
  }

  // ── Live reload: poll mtimes of the open file + expanded dirs ──────
  // Polling (not fs.watch) because the agent edits inside WSL, and Windows
  // file-change events don't fire for the \\wsl.localhost share. stat() over
  // the share always reports current mtimes, so this stays reliable.
  async function poll() {
    if (polling || !projectDir || document.hidden) return;
    polling = true;
    try {
      const dirs = ['', ...expanded];
      const relAtPoll = openRel;   // snapshot: the user can switch files during the await
      const paths = relAtPoll ? [...dirs, relAtPoll] : dirs;
      const res = await ipcRenderer.invoke('code-poll', { paths });
      if (!res) return;
      // Open file: content edits bump the file's own mtime. Only act if the
      // open file is still the one this poll asked about.
      if (relAtPoll && relAtPoll === openRel) {
        const m = res[relAtPoll];
        if (m == null) { showMessage(relAtPoll, 'File no longer available'); openRel = null; }
        else if (openMtime && m !== openMtime) { await reloadOpenFile(); }
        else if (!openMtime) openMtime = m;
      }
      // Tree: create/delete/rename bumps the parent dir's mtime.
      let dirty = false;
      for (const d of dirs) {
        const m = res[d];
        if (m == null) { expanded.delete(d); dirMtimes.delete(d); dirty = true; continue; }
        const prev = dirMtimes.get(d);
        if (prev !== undefined && prev !== m) dirty = true;
        dirMtimes.set(d, m);
      }
      if (dirty) await buildTree();
    } catch (_) {} finally { polling = false; }
  }
  function startPoll() { if (!pollTimer) pollTimer = setInterval(poll, 1200); }
  function stopPoll()  { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  async function refresh() {
    projectDir = (await ipcRenderer.invoke('get-project-dir')) || '';
    if (!projectDir) {
      const saved = localStorage.getItem(LS.projectDir);
      if (saved) { ipcRenderer.send('set-project-dir', { dir: saved }); projectDir = saved; }
    }
    if (!projectDir) { stopPoll(); emptyEl.style.display = 'flex'; mainEl.style.display = 'none'; return; }
    emptyEl.style.display = 'none';
    mainEl.style.display = 'flex';
    rootNameEl.textContent = basename(projectDir);
    rootNameEl.title = projectDir;
    expanded.clear(); dirMtimes.clear();
    openRel = null; openName = null; openMtime = 0;
    showMessage('', 'Select a file to view it');
    await buildTree();
    startPoll();
  }

  async function pickFolder() {
    const dir = await ipcRenderer.invoke('pick-project-dir');
    if (dir) { localStorage.setItem(LS.projectDir, dir); await refresh(); }
  }

  openBtn?.addEventListener('click', pickFolder);
  changeBtn?.addEventListener('click', pickFolder);
  refreshBtn?.addEventListener('click', () => { if (projectDir) buildTree(); });

  window.__onCodeTabActive = function () {
    if (firstActivation || !projectDir) { firstActivation = false; refresh(); }
    else { if (editor) requestAnimationFrame(() => editor.layout()); startPoll(); }
  };
  window.__onCodeTabInactive = function () { stopPoll(); };
})();

// ── Ready ─────────────────────────────────────────────────────────
const _savedApiKey = secureGet(LS.apiKey);
if (_savedApiKey) ipcRenderer.send('set-api-key', _savedApiKey);
ipcRenderer.send('renderer-ready');
