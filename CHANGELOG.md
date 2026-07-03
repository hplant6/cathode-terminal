# Changelog

All notable changes to Cathode Terminal are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.3] - 2026-07-03

### Fixed
- **Terminal output was silently dropped** — the PTY output coalescing buffer stringified session ids, so every terminal (agent TUIs, the chat/terminal toggle) rendered blank. All terminals work again.
- Replaced the deprecated canvas terminal renderer (silent blank-text failure mode) with xterm's DOM renderer.
- Usage meters are now agent-aware: non-Claude agents show their own context-window dial and a session-token count instead of Claude's context/limits/cost; a lone dial no longer renders oversized.

### Added
- **Hermes now runs as a chat agent (ACP)** with its own CLI-style banner — via a bidirectional stdio bridge and authenticate-first connection.
- Session tabs are restored on launch (which tabs were open + which was active).
- Multi-project Storybook resolution: `.cathode/storybook.json` manifest per project + `STORYBOOK_URL` injected into agent sessions.
- Chat font size slider (Settings → Chat Font Size…), styled after the design-system slider.
- F12 toggles DevTools for the app window itself.

### Changed
- Status-bar loader animates while connecting/installing, not just while working.
- Small UI polish: square logo-chevron hover (3px radius), no fill on agent-tab close-button hover.

## [1.0.2] - 2026-07-03

### Fixed
- macOS builds are now ad-hoc signed so they launch on Apple Silicon — clear the download quarantine once with `xattr -cr` (no manual `codesign` needed).

## [1.0.1] - 2026-07-03

### Added
- Automatic updates on Windows and Linux (electron-updater) — installed apps check GitHub Releases on launch, download in the background, and install on restart. macOS auto-update awaits code signing.

## [1.0.0] - 2026-07-03

### Added
- Multi-platform release builds — Windows, macOS, and Linux — via a GitHub Actions workflow triggered on `v*` tags.
- Hermes (Nous Research) as a terminal agent, with an in-session "connect a model" setup card.
- Dropdown of known agents in **Manage LLMs → Add Profile** (re-add without retyping) and a juggler install spinner.
- Project documentation: README, MIT license, CONTRIBUTING, architecture guide, and security policy.

### Changed
- macOS builds are signing- and notarization-ready (hardened runtime + entitlements, gated behind CI secrets).
- The System panel's per-process breakdown (`topProcs`) now works on Linux.

<!-- On release: rename this section to `## [X.Y.Z] - YYYY-MM-DD` and start a fresh
     `## [Unreleased]` above it. -->

[Unreleased]: https://github.com/hplant6/cathode-terminal/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.3
[1.0.2]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.2
[1.0.1]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.1
[1.0.0]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.0
