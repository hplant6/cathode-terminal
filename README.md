<div align="center">
  <img src="icon.png" width="128" alt="Cathode Terminal" />
  <h1>Cathode Terminal</h1>
  <p><strong>A split chat + browser dev tool for AI coding agents.</strong></p>
  <p>
    Pair Claude Code, Codex, Gemini, Aider, LLM, or Hermes with an embedded browser and
    point them at live pages — inspect elements, pick components, capture screenshots,
    and hand context straight to your agent.
  </p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-FF5720.svg)](LICENSE)
  [![Release](https://img.shields.io/github/v/release/hplant6/cathode-terminal?color=FF5720)](https://github.com/hplant6/cathode-terminal/releases)
  ![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-333)
</div>

---

## Screenshot

<!-- Replace with a real screenshot or demo GIF: drop it in docs/ and update the path below. -->
> _Screenshot coming soon — a split view with an agent chat on the left and the embedded browser on the right._

## Features

- **Split workspace** — an AI coding agent on the left, an embedded Chromium browser on the right, resizable.
- **Multiple agents** — Claude Code, OpenAI Codex CLI, Gemini CLI, Aider, LLM CLI, and Hermes. ACP-capable agents get a rich chat UI; the rest run as their native terminal TUI.
- **Page-inspection tools** — Box/Lasso select, Pick component, Extract, Eyedropper, Resize, Accessibility, Screenshot, and Draw. Target any element on a live page and send it to your agent.
- **Embedded DevTools** — inspect the browsed page without leaving the app.
- **Live gauges** — context-window fill and your Claude usage limits (5-hour / weekly) as real-time dials.
- **System panel** — CPU / RAM / GPU meters plus a top-process breakdown.
- **Integrated terminal** — a full xterm terminal per session; toggle any session between chat and terminal.
- **Design-system aware** — connect a Storybook to insert components, and a Figma MCP for design context.
- **Audits & code review** — run audits and review changes in-app.
- **Theming** — a shade-based theme engine with presets.

## Requirements

- **Windows** — [WSL 2](https://learn.microsoft.com/windows/wsl/install); agents run inside the Linux environment.
- **macOS / Linux** — agents run in your native login shell.
- **At least one agent CLI** — Claude Code, Codex, Gemini, Aider, LLM, or Hermes. Cathode's first-run setup helps install what's missing.

## Install

Grab the latest build for your platform from the [**Releases**](https://github.com/hplant6/cathode-terminal/releases) page:

| Platform | Files |
| --- | --- |
| **Windows** | `.exe` installer or portable `.exe` |
| **macOS** | `.dmg` (Apple Silicon + Intel) |
| **Linux** | `.AppImage`, `.deb`, or `.tar.gz` |

> On first launch, Cathode walks you through installing WSL (on Windows) and your chosen agent.

## Quick start

1. Launch Cathode and complete setup for your agent.
2. Enter a URL or `localhost:3000` in the browser bar to load a site or local dev server.
3. Use a toolbar tool to select an element, then send it to your agent in the chat.
4. Toggle a session between **chat** and **terminal**, or open the embedded **DevTools**.

## Supported agents

| Agent | Mode |
| --- | --- |
| Claude Code | Chat (ACP) |
| OpenAI Codex CLI | Chat (ACP) |
| Gemini CLI | Chat (ACP) |
| Aider | Terminal TUI |
| LLM CLI | Terminal |
| Hermes | Terminal TUI |

Install, add, or remove agents any time from **Manage LLMs**.

## Build from source

```bash
git clone https://github.com/hplant6/cathode-terminal.git
cd cathode-terminal
npm install
npm start
```

Package installers:

```bash
npm run dist:win     # Windows  — .exe + portable
npm run dist:mac     # macOS    — .dmg + .zip (arm64 + x64)
npm run dist:linux   # Linux    — .AppImage + .deb + .tar.gz
```

> macOS and Linux targets must be built on that OS (native toolchain required). The
> [release workflow](.github/workflows/release.yml) builds all three on their own
> runners when you push a `v*` tag.

## Tech stack

Electron · [node-pty](https://github.com/microsoft/node-pty) · [xterm.js](https://xtermjs.org) · [Monaco](https://microsoft.github.io/monaco-editor/) · [Agent Client Protocol](https://agentclientprotocol.com) · a bundled Storybook design system.

## Contributing

Contributions are welcome. Clone, `npm install`, `npm start` (see [Build from source](#build-from-source)), and open a PR. Found a bug or have an idea? Open an [issue](https://github.com/hplant6/cathode-terminal/issues).

## License

[MIT](LICENSE) © hplan
