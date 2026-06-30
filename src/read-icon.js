// Module-load icon reads must never throw. Each inject module (and main.js) reads
// its cursor/icon SVGs at require() time during app startup, so a single missing or
// unreadable asset would brick launch before any error UI exists. These helpers
// degrade to an empty asset instead — the cursor/CSS simply falls back to its
// built-in default (e.g. `crosshair`/`move`).
const fs = require('fs');

function iconB64(fullPath) {
  try { return Buffer.from(fs.readFileSync(fullPath, 'utf8')).toString('base64'); }
  catch (_) { return ''; }
}
function iconText(fullPath) {
  try { return fs.readFileSync(fullPath, 'utf8'); }
  catch (_) { return ''; }
}

module.exports = { iconB64, iconText };
