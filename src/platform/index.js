// ── Platform abstraction layer ────────────────────────────────────
// All OS-specific branching for CathodeTerminal lives here so main.js can stay
// platform-agnostic. The Windows code paths are preserved verbatim: on Windows
// the "*nix environment" agents/tools run in is WSL, reached via wsl.exe, and
// every translator below is the identity there. On macOS/Linux there is no WSL —
// agents and tools are installed natively, so commands run in the user's login
// shell (or sh/echo/git directly).
const { execFile, spawn } = require('child_process');

const PLATFORM = process.platform;
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';
const IS_LINUX = !IS_WIN && !IS_MAC;

// The login shell used to run agent commands on POSIX. On Windows this is unused
// (commands go through wsl.exe).
const LOGIN_SHELL = process.env.SHELL || '/bin/bash';

function homeDir() { return process.env.USERPROFILE || process.env.HOME || process.cwd(); }

// ── Shell command translation ─────────────────────────────────────
// Translate a WSL-style argument vector (what we would pass to wsl.exe) into the
// concrete { file, args } for the current platform.
//   Windows → identity (file = wsl.exe), so behaviour is byte-identical.
//   POSIX   → the command runs in the native login shell (or sh/echo/<bin>).
// Recognised WSL arg-forms (the only ones this app uses):
//   ['bash','-lic',cmd] / ['bash','-lc',cmd] → login shell with that flag
//   ['-e','sh','-c',cmd]                     → sh -c cmd
//   ['-e',<bin>,...args]                     → <bin> args   (e.g. -e echo ok)
//   ['-d',<distro>,<bin>,...args]            → <bin> args   (gitBase WSL form)
function nixFileArgs(wslArgs) {
  if (IS_WIN) return { file: 'wsl.exe', args: wslArgs };
  const a = wslArgs;
  if (a[0] === 'bash' && (a[1] === '-lic' || a[1] === '-lc')) {
    return { file: LOGIN_SHELL, args: [a[1], a[2]] };
  }
  if (a[0] === '-e' && a[1] === 'sh' && a[2] === '-c') {
    return { file: 'sh', args: ['-c', a[3]] };
  }
  if (a[0] === '-e') {
    return { file: a[1], args: a.slice(2) };
  }
  if (a[0] === '-d') {
    return { file: a[2], args: a.slice(3) };
  }
  return { file: a[0], args: a.slice(1) };
}

// Translate a `cmd.exe /c ...` argument vector. On Windows: identity. On POSIX
// there is no cmd.exe and no WSL/Windows split — run the target binary directly.
//   ['/c','npm','install',…] → npm install …
//   ['/c',<bin>,…args]       → <bin> args
function cmdFileArgs(cmdArgs) {
  if (IS_WIN) return { file: 'cmd.exe', args: cmdArgs };
  if (cmdArgs[0] === '/c') return { file: cmdArgs[1], args: cmdArgs.slice(2) };
  return { file: cmdArgs[0], args: cmdArgs.slice(1) };
}

// Convert a Windows path (C:\Users\… or a temp file) into a path the *nix
// environment can read. On Windows: WSL's /mnt/<drive>/… mapping. On POSIX the
// path is already native — identity.
function toNixPath(winPath) {
  if (!IS_WIN) return winPath;
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

// The WSL arg-vector that resolves the Claude config dir as a path the Windows
// (or native) side can read. Windows: wslpath -w ~/.claude (WSL home → UNC/Win
// path for the Windows-side adapter). POSIX: the native ~/.claude.
function claudeConfigDirArgs() {
  return IS_WIN
    ? ['bash', '-lc', 'wslpath -w ~/.claude']
    : ['bash', '-lc', 'echo "$HOME/.claude"'];
}

// ── Generic *nix runners (delegate to nixFileArgs) ────────────────
// execFile-based: resolves stdout string, or null on error.
function nixExecFile(wslArgs, timeout = 6000) {
  const { file, args } = nixFileArgs(wslArgs);
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'utf8', timeout }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// spawn + stdin: resolves true on exit code 0.
function nixExecInput(wslArgs, input, timeout = 5000) {
  const { file, args } = nixFileArgs(wslArgs);
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    try {
      const p = spawn(file, args);
      p.on('close', code => finish(code === 0));
      p.on('error', () => finish(false));
      setTimeout(() => { try { p.kill(); } catch (_) {} finish(false); }, timeout);
      p.stdin.write(input);
      p.stdin.end();
    } catch (_) { finish(false); }
  });
}

// Long-lived spawn → returns ChildProcess (caller wires stdout/exit).
function nixSpawn(wslArgs, opts = {}) {
  const { file, args } = nixFileArgs(wslArgs);
  return spawn(file, args, opts);
}

// Spawn a Windows-native (cmd.exe /c) command, or its POSIX equivalent.
function cmdSpawn(cmdArgs, opts = {}) {
  const { file, args } = cmdFileArgs(cmdArgs);
  return spawn(file, args, opts);
}

// ── Environment probes ────────────────────────────────────────────
// Is the *nix environment reachable? (WSL installed/working on Windows;
// always true on POSIX, where the native shell is the environment.)
function checkNixEnv(timeout = 6000) {
  if (!IS_WIN) return Promise.resolve(true);
  return new Promise(resolve => {
    try {
      const p = spawn('wsl.exe', ['-e', 'echo', 'cathode-ok']);
      let out = '';
      p.stdout.on('data', d => out += d.toString());
      p.on('close', () => resolve(/cathode-ok/.test(out)));
      p.on('error', () => resolve(false));
      setTimeout(() => { try { p.kill(); } catch (_) {} resolve(false); }, timeout);
    } catch (_) { resolve(false); }
  });
}

// Where an agent binary actually lives, so we run it where it works.
//   Windows → 'wsl' (real WSL install) | 'win' (Windows npm via cmd.exe) | null
//   POSIX   → 'native' (on PATH) | null
// Consumers branch on env === 'win' (cmd.exe path); every other non-null value
// ('wsl' / 'native') flows through the nix path, which nixFileArgs maps to WSL
// on Windows and the native login shell on POSIX.
const _agentEnvCache = new Map();
function resolveAgentEnv(bin) {
  if (_agentEnvCache.has(bin)) return Promise.resolve(_agentEnvCache.get(bin));
  const cache = env => { _agentEnvCache.set(bin, env); return env; };
  if (!IS_WIN) {
    return new Promise(res => {
      try {
        const p = spawn('sh', ['-c', `command -v ${bin} >/dev/null 2>&1`], { stdio: 'ignore' });
        p.on('close', c => res(cache(c === 0 ? 'native' : null)));
        p.on('error', () => res(cache(null)));
      } catch (_) { res(cache(null)); }
    });
  }
  return (async () => {
    let env = null;
    const wslPath = ((await nixExecFile(['bash', '-lic', `command -v ${bin} 2>/dev/null`], 6000)) || '').trim();
    if (wslPath && !wslPath.startsWith('/mnt/')) {
      env = 'wsl';                    // a real WSL install (not a /mnt/c interop shim)
    } else {
      const onWindows = await new Promise(res => {
        try { const p = spawn('where.exe', [bin], { stdio: 'ignore' }); p.on('close', c => res(c === 0)); p.on('error', () => res(false)); }
        catch (_) { res(false); }
      });
      env = onWindows ? 'win' : (wslPath ? 'wsl' : null);
    }
    return cache(env);
  })();
}

// Version string for a Windows-native (cmd.exe) agent binary. POSIX equivalent
// runs the binary directly.
function agentVersion(bin) {
  return new Promise(res => {
    let out = '';
    try {
      const { file, args } = cmdFileArgs(['/c', bin, '--version']);
      const p = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      p.stdout.on('data', d => out += d);
      p.on('close', () => res(out.trim().split('\n').filter(Boolean).pop() || ''));
      p.on('error', () => res(''));
      setTimeout(() => { try { p.kill(); } catch (_) {} res(out.trim()); }, 6000);
    } catch (_) { res(''); }
  });
}

// cwd for a Windows-native agent: cmd.exe can't use a \\wsl.localhost UNC dir,
// so fall back to home. On POSIX the session cwd is always a real path.
function agentCwd(cwd, home = homeDir()) {
  if (IS_WIN) return (cwd && !cwd.startsWith('\\\\')) ? cwd : home;
  return cwd || home;
}

// ── git ───────────────────────────────────────────────────────────
// Windows: WSL git for \\wsl.localhost UNC paths, native git -C for drive paths.
// POSIX: always native git -C.
function gitBase(dir) {
  if (IS_WIN) {
    const m = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i.exec(dir);
    if (m) return { bin: 'wsl.exe', prefix: ['-d', m[1], 'git', '-C', '/' + m[2].replace(/\\/g, '/')] };
  }
  return { bin: 'git', prefix: ['-C', dir] };
}

// ── System metrics ────────────────────────────────────────────────
// GPU 3D-engine utilization sampler. Windows-only (Get-Counter); elsewhere the
// reading stays null and the UI degrades gracefully.
let _gpuPct = null;            // null → unavailable
let _gpuProc = null;
function startGpuSampler() {
  if (!IS_WIN || _gpuProc) return;
  // Sum the 3D-engine utilization across all GPU adapters (≈ Task Manager's
  // "3D" reading). Streams one rounded number every 2s; 'NA' on failure.
  const script =
    "while($true){try{" +
    "$s=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples;" +
    "$sum=($s|Measure-Object -Property CookedValue -Sum).Sum;" +
    "Write-Output ([math]::Round($sum))}catch{Write-Output 'NA'};" +
    "Start-Sleep -Milliseconds 2000}";
  try {
    _gpuProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    _gpuProc.stdout.on('data', (d) => {
      const line = d.toString().trim().split(/\r?\n/).pop().trim();
      _gpuPct = (line === 'NA' || line === '') ? null : Math.max(0, Math.min(100, parseInt(line, 10) || 0));
    });
    _gpuProc.on('error', () => { _gpuPct = null; _gpuProc = null; });
    _gpuProc.on('close', () => { _gpuProc = null; });
  } catch (_) { _gpuProc = null; }
}
function gpuPercent() { return _gpuPct; }
function stopGpuSampler() { if (_gpuProc) { try { _gpuProc.kill(); } catch (_) {} _gpuProc = null; } }

// Top processes by memory or CPU, grouped by name. Windows-only for now; POSIX
// returns { ok: false } (native ps/top breakdown is a later step).
// macOS: group `ps` output by executable basename. GPU% needs sudo on macOS, so
// it stays null (the UI degrades) — CPU/RAM are the useful signals here.
function topProcsMac(by) {
  const cpu = by === 'cpu';
  const field = cpu ? '%cpu' : 'rss';
  return new Promise(resolve => {
    execFile('ps', ['-axo', `${field}=,comm=`], { encoding: 'utf8', maxBuffer: 1 << 20, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) { resolve({ ok: false }); return; }
      const sums = new Map();
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^([\d.]+)\s+(.+)$/);
        if (!m) continue;
        const name = m[2].replace(/.*\//, '');   // basename of the exec path
        sums.set(name, (sums.get(name) || 0) + (parseFloat(m[1]) || 0));
      }
      const procs = [...sums.entries()]
        .map(([name, v]) => ({ name, value: cpu ? Math.round(v * 10) / 10 : v * 1024 }))   // rss is KB → bytes (match Windows WorkingSet64)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
      resolve({ ok: true, by: cpu ? 'cpu' : 'ram', procs });
    });
  });
}

// Linux: sum %cpu / rss per command via ps — same shape as macOS.
function topProcsLinux(by) {
  const cpu = by === 'cpu';
  const field = cpu ? '%cpu' : 'rss';
  return new Promise(resolve => {
    execFile('ps', ['-eo', `${field}=,comm=`], { encoding: 'utf8', maxBuffer: 1 << 20, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) { resolve({ ok: false }); return; }
      const sums = new Map();
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^([\d.]+)\s+(.+)$/);
        if (!m) continue;
        const name = m[2].replace(/.*\//, '');   // basename of the exec path
        sums.set(name, (sums.get(name) || 0) + (parseFloat(m[1]) || 0));
      }
      const procs = [...sums.entries()]
        .map(([name, v]) => ({ name, value: cpu ? Math.round(v * 10) / 10 : v * 1024 }))   // rss KB → bytes (match Windows WorkingSet64)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
      resolve({ ok: true, by: cpu ? 'cpu' : 'ram', procs });
    });
  });
}

function topProcs(by) {
  if (IS_MAC) return topProcsMac(by);
  if (!IS_WIN) return topProcsLinux(by);
  const cpu = by === 'cpu';
  const cmd = cpu
    ? "$n=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors;" +
      "(Get-Counter '\\Process(*)\\% Processor Time').CounterSamples | " +
      "Where-Object { $_.InstanceName -ne '_total' -and $_.InstanceName -ne 'idle' } | " +
      "Group-Object { $_.InstanceName -replace '#\\d+$','' } | " +
      "ForEach-Object { [pscustomobject]@{ n=$_.Name; v=[math]::Round((($_.Group | Measure-Object CookedValue -Sum).Sum)/$n,1) } } | " +
      "Sort-Object v -Descending | Select-Object -First 6 | ConvertTo-Json -Compress"
    : "Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ n=$_.Name; " +
      "v=(($_.Group | Measure-Object WorkingSet64 -Sum).Sum) } } | " +
      "Sort-Object v -Descending | Select-Object -First 6 | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { windowsHide: true, maxBuffer: 1 << 20, timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) { resolve({ ok: false }); return; }
        try {
          let data = JSON.parse(stdout.trim());
          if (!Array.isArray(data)) data = [data];
          resolve({ ok: true, by: cpu ? 'cpu' : 'ram', procs: data.map(d => ({ name: d.n, value: d.v })) });
        } catch (_) { resolve({ ok: false }); }
      });
  });
}

// ── HiDPI scale ───────────────────────────────────────────────────
// Read the user's *real* display scale. Windows latches the forced
// --force-device-scale-factor, so we consult the registry (AppliedDPI). macOS
// handles Retina automatically — no forcing, so this returns null (keep as-is).
function readRealScale() {
  if (!IS_WIN) return Promise.resolve(null);
  return new Promise(resolve => {
    execFile('reg.exe',
      ['query', 'HKCU\\Control Panel\\Desktop\\WindowMetrics', '/v', 'AppliedDPI'],
      { encoding: 'utf8', timeout: 3000 },
      (err, out) => {
        if (err) return resolve(null);
        const m = (out || '').match(/AppliedDPI\s+REG_DWORD\s+0x([0-9a-f]+)/i);
        resolve(m ? parseInt(m[1], 16) / 96 : null);
      });
  });
}

module.exports = {
  homeDir,
  nixFileArgs, cmdFileArgs, toNixPath, claudeConfigDirArgs,
  nixExecFile, nixExecInput, nixSpawn, cmdSpawn,
  checkNixEnv, resolveAgentEnv, agentVersion, agentCwd,
  gitBase,
  startGpuSampler, stopGpuSampler, gpuPercent, topProcs,
  readRealScale,
};
