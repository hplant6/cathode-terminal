# Contributing to Cathode Terminal

Thanks for your interest! This guide covers running Cathode from source, the codebase layout, and the dev workflow.

## Prerequisites

- **Node.js 20+**
- **Windows only:** [WSL 2](https://learn.microsoft.com/windows/wsl/install) — Cathode runs AI agents inside the Linux environment. macOS/Linux use the native shell.
- **An agent CLI** (optional, for exercising a real session) — e.g. Claude Code.

## Getting started

```bash
git clone https://github.com/hplant6/cathode-terminal.git
cd cathode-terminal
npm install        # postinstall also rebuilds node-pty for your platform
npm start          # launch the app (electron .)
```

## Codebase layout

| Path | What |
| --- | --- |
| `main.js` | Electron **main** process — the window, native `WebContentsView`s, PTY/ACP sessions, and all IPC handlers |
| `src/renderer.js` | The **renderer** — the entire UI (chat, terminal, panels, tools, modals) |
| `src/styles.css`, `src/index.html` | Renderer styles + markup |
| `src/ipc-channels.js` | Frozen `IPC` channel registry — both processes import channel names from here |
| `src/platform/index.js` | OS adapter — WSL (Windows) vs native shell (macOS/Linux) |
| `src/*-inject.js` | Scripts injected into the **browsed page** (picker, resize, draw, eyedropper, screenshot, a11y, combined) |
| `src/tools.js` | Toolbar / page-tool definitions |
| `storybook-demo/` | The design system (Storybook) — reference for UI work |
| `assets/` | Build resources (Windows `.ico`, mac entitlements) |
| `scripts/notarize.js` | macOS notarization hook (electron-builder `afterSign`) |

## Dev workflow — what reloads what

This is the single most important thing to know:

| You changed… | To see it |
| --- | --- |
| `src/renderer.js`, `src/styles.css`, `src/index.html` | **Refresh the window** (Ctrl/Cmd+R) |
| `main.js` **or any `src/*-inject.js`** | **Fully quit and relaunch** |

The inject scripts are serialized to strings and run inside the browsed page at spawn time, so a window refresh won't pick them up — you need a full restart.

## Validating changes

There's no build step for the app, so validate before committing:

```bash
node --check main.js            # syntax-check any .js you touched
node --check src/renderer.js
# CSS brace balance (the two numbers should match):
grep -o '{' src/styles.css | wc -l ; grep -o '}' src/styles.css | wc -l
```

### Storybook (design system)

```bash
cd storybook-demo && npm install && npm run storybook   # http://localhost:6006
```

> Reference the Storybook's tokens/components before UI changes to keep things consistent. New story *files* need a Storybook restart to be indexed.

## Building installers

```bash
npm run dist:win     # Windows  (.exe + portable)
npm run dist:mac     # macOS    (.dmg + .zip) — build on macOS
npm run dist:linux   # Linux    (.AppImage + .deb + .tar.gz) — build on Linux
```

Or push a `v*` tag to build all three via the [release workflow](.github/workflows/release.yml).

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the process model, agent integration (ACP vs terminal), the platform layer, and the inject-script system.

## Pull requests

- Branch off `main`; keep PRs focused.
- Match the surrounding code style — mirror nearby comment density and idiom (there's no linter config).
- Validate (syntax + CSS braces) and note what you smoke-tested; some changes can only be verified by running the app.
- Account for **both Windows (WSL) and macOS/Linux** when touching platform-specific behavior — keep OS divergence in `src/platform` or behind `IS_*` guards.
- Reference any related issue.

## Reporting bugs

Open an [issue](https://github.com/hplant6/cathode-terminal/issues) — the in-app **Settings → Report an Issue** link takes you there too.
