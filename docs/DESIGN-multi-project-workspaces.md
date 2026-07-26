# Design: Multi-Project Workspaces for Cathode Terminal

**Status:** Proposed · **Author:** design pass w/ hplant6 · **Date:** 2026-07-26

Goal: let Cathode juggle several projects instead of revolving around one — switch
project folders in a click, start/stop each project's localhost servers from one
place, and **pause a project (freeing its resources) then resume exactly where you
left off** — all unified in a single surface.

---

## 1. Current architecture (as-is)

Everything below is single-project by construction:

| Concern | Where | Reality today |
|---|---|---|
| Project folder | `currentProjectDir` (main.js:1376), `sessionCwd()` (1378) | **One global cwd.** All chat/terminal/agent spawns use it. Set via `SET_PROJECT_DIR`, persisted in renderer `localStorage` (`LS.projectDir`). |
| "Opening" a project | renderer:9091 / 9144 | **Entangled with Storybook** — choosing a Storybook folder is the main way the project dir gets set. No standalone "Open Project." |
| Tabs / sessions | `sessions` Map (renderer:442) `id → {name,term,fitAddon,el,ro}` | Chat/terminal tabs carry **no project identity**; they inherit the global cwd at spawn time (`acpCwd = sessionCwd()`, main.js:1781). |
| Servers | `sbServers` Map (main.js:905) `id → {id,proc,port,url,dir,label,status,log,managed}` | **Only Storybook** is managed — but with a *complete* lifecycle: start (`sbStartServer` 1149), stop, status events, log capture, PID persist + crash-reap (`storybook-server.json`, 928/980). |
| Right panel | `browserView` + `rightPanelMode` ∈ {project, browser, storybook} (main.js:126) | Single WebContentsView; one persisted URL (`browser-state.json`, 96). |
| Persistence | mixed | userData JSON files (browser-state, storybook-server, watch-approval, display) + renderer `localStorage` + per-project `.cathode/storybook.json` (939). |

**Takeaway:** the pieces for multi-project already exist in single-project form. This is
mostly *promoting global state to per-project state* + generalizing the Storybook server
engine + adding a switcher/overview UI. It is not a rewrite.

---

## 2. Target model

Introduce **Project** (Workspace) as the top-level entity that owns cwd, servers, tabs,
and browser state. Everything currently global becomes per-project, with one active project.

```
Project {
  id, name, rootDir,
  pauseBehavior: 'suspend' | 'keep',        // per-project (user-chosen)
  servers:  [ ServerDef ],                   // generalized sbServers
  browser:  { urls: [], activeUrl },
  defaults: { persona, mode },
  state:    'active' | 'paused',
  lastActiveAt,
  // runtime-only (not persisted): set of tab/session ids in this project
}

ServerDef {
  id, name, cmd, cwd, port, url,
  autostart, kind: 'storybook' | 'dev' | 'custom',
  pauseBehavior?                             // optional per-server override
}
```

**Persistence:** new `projects.json` in `userData` = `{ activeProjectId, projects: [...] }`,
plus saved per-project tab/browser/mode snapshots. Seeded from `.cathode/project.json`
manifests discovered in each `rootDir` (extends the existing `.cathode/storybook.json`
convention). Storybook folds in as a `ServerDef` with `kind:'storybook'`.

---

## 3. Increments (each ships on its own)

### Increment 1 — Project as an entity + Switcher
*Refactor global cwd → active project; add the switcher.*

- Add a `projects` Map + `activeProjectId` in main; persist to `projects.json`.
- Refactor: `sessionCwd()` returns `activeProject.rootDir` (keeps every existing call site working).
- **Decouple from Storybook**: add a first-class "Open Project" (folder picker → create Project,
  auto-detect `name` from folder + scan `package.json` scripts). Storybook setup may still set
  the active project, but is no longer the only path.
- **Switcher home = a chip in the top-left of the titlebar** (next to the app menu, in the
  `#app-bar-spacer` drag region) — the only region above *both* panels, reusing the existing
  `sb-bar-switch` "Switch Storybook" chip idiom. Click → dropdown: project list (with
  running-status dots) · "Open project…" · "Mission Control…".

  ```
  ≡  ▹ Kindo ⌄        ‹view tabs›   – □ ✕
  ```

  *Rejected:* inside the browser tab bar (inverts hierarchy — browser tabs are contained by a
  project, and it collides with the three existing tab concepts); persistent left rail
  (permanent width cost next to the browser pane); Mission-Control-only (switching should be
  one-click, not two steps). MC remains the full cross-project overview it links to.
- **Tag tabs with `projectId`** on create; `renderTabs`/`switchSession` filter to the active
  project. Switching a project shows that project's tabs and restores its browser URL.
- Migration: on first launch, seed one Project from existing `localStorage.projectDir` +
  `storybook-server.json` so current users lose nothing.

**Files:** `main.js` (registry, IPC, persistence, `sessionCwd` refactor) · `src/ipc-channels.js`
(`PROJECT_LIST/OPEN/SWITCH/REMOVE/RENAME`) · `src/renderer.js` (switcher UI, `projectId` on
sessions, tab filter, browser restore) · `src/index.html` · `src/styles.css`.

**Ships:** click-to-switch between projects; each keeps its own tabs + browser + cwd.
No server suspend yet.

### Increment 2 — Services panel (generalize `sbServers`)
*Turn the Storybook engine into a general server manager.*

- Generalize `sbServers` → a `servers` registry keyed by project; `ServerDef.cmd` arbitrary.
  Reuse the whole spawn/supervise/log/status/PID-reap machinery (it's already robust).
- Auto-detect dev servers from `package.json` scripts (`dev`,`start`,`storybook`,…) → seed
  `ServerDef`s; allow user-added custom commands + port.
- **Services panel UI**: list this project's servers (toggle to all projects). Each row =
  status dot · name · port · Start/Stop/Restart · "Open in browser pane" · log peek.
  Storybook becomes one row among many.
- Port-conflict detection + assignment.

**Files:** `main.js` (generalized registry/spawn/logs) · `ipc-channels` (`SERVER_*`) ·
`renderer` (Services panel) · html/css.

**Ships:** the "turn localhost servers on and off from one place" ask.

### Increment 3 — Pause / Resume + Mission Control
*The unified vision.*

- **Pause(project):** snapshot tabs + browser + mode; for servers with `pauseBehavior:'suspend'`,
  stop them (free ports/RAM); leave `'keep'` servers running; mark project `paused`.
  Preserve ACP `sessionId`s for resume.
- **Resume(project):** restart suspended servers; `loadSession` to rehydrate chat (main.js
  already supports resume via `loadSession`, 1947); restore browser URLs, active tab, mode.
- **Mission Control**: an overview surface (modal via `modal-backdrop` convention, or a
  persistent left rail) of project **cards**: active/paused badge · running servers with live
  dots · tab count · last-active time · actions (Switch · Pause · Resume · Stop all).

**Files:** `main.js` (pause/resume orchestration, server suspend) · `renderer` (Mission
Control, state save/restore) · `ipc-channels` · html/css.

**Ships:** per-project pause/resume with real resource savings, unified in one place.

---

## 4. Key decisions & risks

1. **Tabs across projects** — *filter by active project* (recommended; matches pause/resume
   mental model) vs show-all-with-badges. Mission Control is the cross-project view either way.
2. **ACP resume fidelity** — main.js:1950 notes some adapters "can't replay — start fresh."
   Claude supports `loadSession`; for agents that don't, resume = fresh session in the same
   cwd. Document per agent; never silently lose history.
3. **Cross-platform** (Win + macOS, per house rule) — keep **suspend = real stop**, *not*
   `SIGSTOP` process-freezing. Server spawn already routes through the platform layer /
   `nixSpawn`, so no new OS divergence. (This is why "freeze processes" was rejected earlier.)
4. **Storybook entanglement** — migrate carefully: SB config currently drives the project dir
   (renderer:9091/9144). Fold SB into `servers` as a `kind` without breaking existing SB flows;
   `.storybook/` autodetect (main.js:1101+) still works.
5. **Persistence migration** — seed the first Project from existing `localStorage.projectDir`
   + `storybook-server.json` on upgrade; no user re-setup.
6. **PID/port leaks** — generalize the existing crash-reap on launch (main.js:980) to *all*
   managed servers so paused/crashed servers never orphan ports.

---

## 5. Rollout

| PR / version | Increment | Value delivered |
|---|---|---|
| 1 | Project entity + Switcher | Multi-project switching (own tabs/browser/cwd each) |
| 2 | Services panel | Start/stop/restart any localhost server in one place |
| 3 | Pause/Resume + Mission Control | Suspend a project (free resources) + resume exactly where you left off, unified |

Each is independently shippable and testable. Recommend building in order.
