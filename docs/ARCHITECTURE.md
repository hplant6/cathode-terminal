# Architecture

A high-level map of how Cathode Terminal is put together.

## Process model

Cathode is an Electron app with the usual two-process split, plus native views:

- **Main process** (`main.js`) — owns the `BrowserWindow`, spawns agent sessions (PTY via node-pty, or ACP), manages the embedded browser and other panels as **`WebContentsView`s**, and handles all IPC.
- **Renderer** (`src/renderer.js`) — the whole UI: agent chat, terminal (xterm), the usage / system / terminal / devtools panels, toolbar tools, and modals. Runs with `nodeIntegration` (it uses `ipcRenderer` and node-pty types directly).
- **Native views** — the browsed page, DevTools, and popups are `WebContentsView`s composited **above** the HTML DOM. That's why modals *hide* native views (a document-level observer parks them offscreen) rather than z-indexing over them.

## IPC

Every channel name lives in one frozen registry, `src/ipc-channels.js`:

```js
const { IPC } = require('./src/ipc-channels');
```

Both main and renderer use `IPC.CHANNEL_NAME` — never string literals — so channels can't drift out of sync.

## Agents: ACP vs terminal

There are two integration paths, chosen per session by a profile's `acp` flag + `acpAgentFor(command)`:

- **ACP agents** (Claude Code, Codex, Gemini) speak the [Agent Client Protocol](https://agentclientprotocol.com). Main spawns them and exchanges newline-delimited JSON-RPC over stdio, and they render in Cathode's **chat UI** — bubbles, tool cards, streaming, permission prompts. See `ACP_LAUNCH` / `spawnAcpSession` in `main.js`.
- **Terminal agents** (Aider, LLM, Hermes) have no ACP mode, so they run as their native **TUI** inside an xterm terminal (PTY via node-pty). See `spawnPty`.

The client implements the full ACP callback set (permission, `fs/*`, terminal), so any ACP-capable agent that negotiates the protocol version gets the chat UI.

## Platform layer

`src/platform/index.js` abstracts the OS so the rest of the app doesn't branch on `process.platform`:

- **Windows** — agents run inside **WSL 2** (`wsl.exe bash -lic …`). Some tools may be installed via *Windows* npm, so `resolveAgentEnv` detects where each binary actually lives.
- **macOS / Linux** — agents run in the native login shell.

`IS_WIN` / `IS_MAC` / `IS_LINUX` branch only where behavior genuinely differs (window chrome, `topProcs`). Keep OS divergence here or behind those guards.

## Injected page tools

The toolbar tools (Box/Lasso select, Pick component, Extract, Eyedropper, Resize, Screenshot, Draw, Accessibility) work by **injecting a script into the browsed page** (`src/*-inject.js`):

- Each script is serialized to a string and run via `webContents.executeJavaScript`. It draws an overlay in the page, captures a selection, and returns it to main.
- `inject-styles.js` / `inject-shared.js` hold shared bits — the orange "marching-ants" selection outline, keyframes, helpers.
- `combined-inject.js` is the persistent page-tools panel. **Note:** it's serialized with `.toString()`, so build-time `${}` interpolation can't reach its body — pass values another way.

Because these run at spawn time, editing an inject script requires a **full app restart** (not a window refresh).

## Theming

A shade-based theme engine in the renderer (`THEME_TOKENS` / `THEME_PRESETS`) drives the `--spec-*` CSS variables; presets plus a custom-theme editor live in the theme modal. The brand accent is orange (`#FF5720`).

## Packaging

electron-builder (the `build` block in `package.json`) targets:

- **Windows** — NSIS installer + portable.
- **macOS** — dmg + zip (arm64 + x64); hardened runtime + entitlements, notarized when signing secrets are present (`scripts/notarize.js`).
- **Linux** — AppImage + deb + tar.gz.

node-pty ships prebuilds for Windows/macOS and **builds from source on Linux** (needs python3 + a C toolchain). The [release workflow](../.github/workflows/release.yml) builds all three on their native runners on a `v*` tag.
