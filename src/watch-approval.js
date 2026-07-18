// Watch Approval bridge.
//
// Mirrors a Cathode tool-permission prompt to the Watch Approval phone app (see the
// `watch-approval` repo) so a risky tool call can be approved/denied from an Apple
// Watch. This runs *in parallel* with the in-app permission modal: whichever side
// answers first wins. Every call here is best-effort — if the relay is down, the
// feature is off, or `fetch` throws, we silently fall back to the in-app modal with
// no change in behavior.
//
// Config lives in `<userData>/watch-approval.json` (same convention as the app's other
// small state files), with env-var overrides:
//   { "enabled": true, "url": "http://localhost:8420", "secret": "", "pollMs": 1500 }
// The relay reaches localhost from Windows even when it runs WSL-side (WSL2 forwards
// localhost), so the default URL works for the common desktop setup.

const fs = require('fs');
const path = require('path');

function configPath() {
  const { app } = require('electron'); // lazy — userData is only valid after app is ready
  return path.join(app.getPath('userData'), 'watch-approval.json');
}

// Read config fresh each time so toggling enabled/url doesn't need an app restart.
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) {}
  return {
    enabled: !!cfg.enabled || process.env.WATCH_APPROVAL_ENABLED === '1',
    url: String(cfg.url || process.env.WATCH_APPROVAL_URL || 'http://localhost:8420').replace(/\/+$/, ''),
    secret: cfg.secret || process.env.WATCH_APPROVAL_SECRET || '',
    pollMs: Number(cfg.pollMs) || 1500,
    maxMs: Number(cfg.maxMs) || 300000, // stop polling after ~the relay's own timeout
  };
}

function isEnabled() {
  return loadConfig().enabled;
}

async function apiCall(cfg, method, apiPath, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.secret) headers['Authorization'] = `Bearer ${cfg.secret}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${cfg.url}${apiPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null; // unreachable relay, timeout, missing fetch — degrade to in-app only
  } finally {
    clearTimeout(timer);
  }
}

// Start a wrist prompt alongside the in-app modal.
//   summary: human one-liner shown on the phone/watch (e.g. "Run: npm test")
//   kind:    the ACP tool kind (execute/edit/delete/…)
//   onDecision(decision): called at most once with 'approve' | 'deny' when the watch
//            answers first. The caller wires this to resolve the same promise the
//            in-app modal resolves, so the two race naturally.
// Returns { done } — call done() once the prompt is settled by *any* source to stop
// polling and, if the in-app side won, cancel the relay request so a late wrist tap
// cleanly no-ops instead of flipping an already-decided prompt.
function begin({ summary, kind, onDecision }) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { done() {} };

  let stopped = false;
  let decided = false;

  // POST returns the relay's request_id; keep the promise so done() can cancel even if
  // the in-app side wins before the POST resolves.
  const submitted = apiCall(cfg, 'POST', '/api/request', {
    tool_name: kind || 'tool',
    tool_input: {},
    summary,
    kind,
  }).then(r => (r && r.request_id) || null);

  (async () => {
    const id = await submitted;
    if (!id || stopped) return;
    const deadline = Date.now() + cfg.maxMs;
    while (!stopped) {
      if (Date.now() > deadline) return; // relay gone/expired — leave the in-app modal in charge
      const r = await apiCall(cfg, 'GET', `/api/request/${id}`);
      const status = r && r.status;
      if (status === 'approved' || status === 'denied') {
        if (!stopped) {
          stopped = true;
          decided = true;
          onDecision(status === 'approved' ? 'approve' : 'deny');
        }
        return;
      }
      // timeout / cancelled / not_found → stop polling; the in-app modal remains.
      if (status && status !== 'pending') return;
      await new Promise(res => setTimeout(res, cfg.pollMs));
    }
  })().catch(() => {});

  return {
    done() {
      if (stopped) return;
      stopped = true;
      if (!decided) {
        // In-app (or session teardown) won the race — settle the relay request.
        submitted.then(id => { if (id) apiCall(cfg, 'POST', `/api/cancel/${id}`); }).catch(() => {});
      }
    },
  };
}

module.exports = { isEnabled, loadConfig, begin };
