# Changelog

All notable changes to Cathode Terminal are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/hplant6/cathode-terminal/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.0
