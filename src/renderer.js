const { ipcRenderer } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');

// ── Terminal setup ────────────────────────────────────────────────
const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  theme: {
    background:          '#1e1e1e',
    foreground:          '#cccccc',
    cursor:              '#4a9eff',
    selectionBackground: 'rgba(74,158,255,0.3)',
    black:               '#1a1a1a', brightBlack:   '#555555',
    red:                 '#f44747', brightRed:     '#f44747',
    green:               '#6a9955', brightGreen:   '#b5cea8',
    yellow:              '#dcdcaa', brightYellow:  '#dcdcaa',
    blue:                '#569cd6', brightBlue:    '#9cdcfe',
    magenta:             '#c586c0', brightMagenta: '#c586c0',
    cyan:                '#4ec9b0', brightCyan:    '#4ec9b0',
    white:               '#d4d4d4', brightWhite:   '#ffffff',
  },
  scrollback: 5000,
  allowProposedApi: true,
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));
fitAddon.fit();

term.onData((data) => ipcRenderer.send('pty-input', data));
ipcRenderer.on('pty-output', (_, data) => term.write(data));

const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  ipcRenderer.send('pty-resize', { cols: term.cols, rows: term.rows });
});
resizeObserver.observe(document.getElementById('terminal-container'));

// ── Restart ───────────────────────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', () => {
  term.clear();
  ipcRenderer.send('pty-restart');
});

// ── Divider drag ──────────────────────────────────────────────────
const divider   = document.getElementById('divider');
const leftPanel = document.getElementById('left-panel');
let dragging = false;

divider.addEventListener('mousedown', (e) => {
  dragging = true;
  divider.classList.add('dragging');
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const fraction = Math.min(0.75, Math.max(0.2, e.clientX / document.getElementById('app').offsetWidth));
  leftPanel.style.width = (fraction * 100) + '%';
  ipcRenderer.send('split-changed', fraction);
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove('dragging');
  fitAddon.fit();
  ipcRenderer.send('pty-resize', { cols: term.cols, rows: term.rows });
});

// ── Browser toolbar ───────────────────────────────────────────────
const addressBar = document.getElementById('address-bar');

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { ipcRenderer.send('browser-navigate', addressBar.value); addressBar.blur(); }
  if (e.key === 'Escape') addressBar.blur();
});
addressBar.addEventListener('focus', () => addressBar.select());

document.getElementById('btn-back').addEventListener('click',    () => ipcRenderer.send('browser-go-back'));
document.getElementById('btn-forward').addEventListener('click', () => ipcRenderer.send('browser-go-forward'));
document.getElementById('btn-reload').addEventListener('click',  () => ipcRenderer.send('browser-reload'));
document.getElementById('btn-home').addEventListener('click',    () => ipcRenderer.send('browser-navigate-home'));
const devToolsBtn = document.getElementById('btn-devtools');
devToolsBtn.addEventListener('click', () => ipcRenderer.send('browser-toggle-devtools'));
ipcRenderer.on('devtools-opened', () => devToolsBtn.classList.add('active'));
ipcRenderer.on('devtools-closed', () => devToolsBtn.classList.remove('active'));

ipcRenderer.on('browser-url-changed', (_, url) => {
  addressBar.value = (url && url !== 'about:blank') ? url : '';
});

// ── Pick mode ─────────────────────────────────────────────────────
let pickMode = null; // 'box' | 'lasso' | null

function setPickMode(mode) {
  if (pickMode === mode) {
    // Toggle off — cancel pick
    pickMode = null;
    document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
    return;
  }
  pickMode = mode;
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-pick-${mode}`).classList.add('active');
  ipcRenderer.send('pick-start', mode);
}

document.getElementById('btn-pick-box').addEventListener('click',    () => setPickMode('box'));
document.getElementById('btn-pick-lasso').addEventListener('click',  () => setPickMode('lasso'));
document.getElementById('btn-screenshot').addEventListener('click',  () => {
  if (pickMode === 'screenshot') { clearPickMode(); return; }
  clearPickMode();
  pickMode = 'screenshot';
  document.getElementById('btn-screenshot').classList.add('active');
  ipcRenderer.send('pick-screenshot');
});

function clearPickMode() {
  pickMode = null;
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
}

ipcRenderer.on('pick-cancelled', () => clearPickMode());

// pick-cancelled clears the active button state (pick-complete does the same)
ipcRenderer.on('pick-complete', () => clearPickMode());

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); addressBar.focus(); }
  if (e.key === 'F5')  ipcRenderer.send('browser-reload');
  if (e.key === 'F12') ipcRenderer.send('browser-toggle-devtools');
  // Ctrl+Shift+B = box pick, Ctrl+Shift+L = lasso pick
  if (e.ctrlKey && e.shiftKey && e.key === 'B') setPickMode('box');
  if (e.ctrlKey && e.shiftKey && e.key === 'L') setPickMode('lasso');
});

// ── Ready ─────────────────────────────────────────────────────────
ipcRenderer.send('renderer-ready');
