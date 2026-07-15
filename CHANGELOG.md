# Changelog

All notable changes to Cathode Terminal are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Box/Lasso tool: "User Added" CSS properties.** Each selected element's drawer now has a **User Added** section with a searchable property picker, so you can add *any* CSS property — even ones the detected list omits (e.g. `padding`/`margin` on an element that currently has none, which were filtered out). Pick a property, type a value (applies live, arrow-keys to nudge numbers), and it's included in the edits sent to the agent.

### Fixed
- **Right-click on a misspelled word now offers spelling suggestions.** The composer (and every spellchecked input) underlined misspellings but its context menu only had Cut/Copy/Paste — now it lists the dictionary suggestions (click to replace) plus "Add to Dictionary", above the edit actions.
- **Screenshot tool now preserves the `:hover` state.** Launching the tool moved the pointer off the page (to the toolbar button), so the element's hover cleared before you could capture it. A lightweight per-page tracker remembers the last-hovered element, and on capture Cathode force-holds its `:hover` (and its ancestors') via CDP through the region selection and snapshot — so you can actually screenshot a hover interaction. (CSS `:hover` styles; JS-driven hover menus still can't be frozen. No effect when DevTools is open, since it holds the debugger.)

### Added
- **Clear session** in the agent-tab kebab menu — starts a fresh conversation while **keeping the current model**. Previously the only way to reset an ACP session was to switch models; now you can clear without changing anything. Restarts the adapter with the same model and wipes the chat (the banner re-renders on reconnect); for terminal sessions it restarts the command.

## [1.0.35] - 2026-07-14

### Changed
- **AI Spend modal: monthly dollar budget → session budget.** The "Monthly budget" dollar field is now a **Session budget** slider (share of your 5-hour session limit) with a live bar showing current usage against it — the same setting Budget Guard uses, editable from either place. The modal also gained a **Write handoff brief** button so you can export a handoff brief any time, not only at the limit.
- **Design system gained a Slider** — added a `Slider` component to the Storybook (filled track à la `ProgressBar`, accent thumb à la `Switch`), and the Budget Guard / AI Spend sliders now use a matching reusable `.ds-slider` style built on the design tokens (replacing bare `accent-color` range inputs).

### Added
- **Budget Guard** (Settings → Budget Guard) — watches your Claude usage limit and helps you keep working when it runs low. Set a threshold (a slider, % of your 5-hour session limit; optionally also watch the weekly limit) at which it advises handing off. When you cross it, the guard can pop up automatically (once per limit window). The hand-off is agent-driven: the **current agent writes a self-contained brief** (goal, state, decisions, files changed, next steps, gotchas) to `HANDOFF.md` (or `AGENTS.md`), then **"Continue on Hermes"** (which stays locked until the brief has actually been written for the current project) opens a fresh session on your chosen budget agent (Hermes/Gemini/Codex) with its composer primed to read the brief and pick up — minimal re-explanation from you. Keys off the real subscription-limit signal (`/api/oauth/usage`), not dollar estimates. Once you're over the threshold, a passive **"hand off" chip** also appears at the top of the Usage panel (click to open the guard), so the nudge is visible even if you've turned off the auto-popup.
- **Design-drift scanner now covers type, radius, and shadow** (was colors-only). It discovers font-size, border-radius, and box-shadow tokens from `:root` custom properties and flags element values that are a near-miss — a `13px` that should be your `--font-size-sm`, a `5px` corner that should be `--radius-sm`, a hand-rolled `box-shadow` that should be `--shadow-md`. Length tokens are matched by name so a radius token is never suggested for a font-size (and vice-versa); shadows match structurally (offset/blur/spread + color), tolerant of the computed-vs-authored form. Findings are grouped by category in the panel, each with a live on-page preview of the fix.
- **Design-drift scanner reads tokens from a connected Storybook.** When a Storybook is connected, the scanner pulls its preview `:root` design tokens and matches drift against *those* first — so a page's stale local copy of a token snaps to the canonical design-system value, not itself. Storybook tokens win over page `:root` tokens on name conflicts; the page's own tokens still fill any gaps. The panel notes when Storybook tokens are in play, and the agent hand-off says to treat them as the source of truth.

### Fixed
- **"Start Storybook" now finds a Storybook nested in your project** — detection was only looking one level deep, so a repo/monorepo whose Storybook lives in a subfolder read as "no Storybook." It now searches down to 4 levels (skipping `node_modules`, build/output dirs, etc.), and resolves the `storybook` bin by walking up from the config dir so a hoisted workspace `node_modules` still works.

### Changed
- **Storybook setup tabs reordered** to Connect Existing → Run a storybook → Build with figma → Use a framework, with Connect first and its URL prefilled to `http://localhost:6006` (clearable).
- **First-run defaults** — a fresh install now opens with the system-performance panel hidden and the usage panel in its compact dial view (only seeded on first run; a returning user's toggles are untouched).

## [1.0.29] - 2026-07-08

### Fixed
- **Restart button no longer hides behind the AUDIT dropdown.** The vertical tool rail's "dodge" was shoving the audit button alone onto the restart button; now the whole `+ · restart · AUDIT` cluster shifts as a unit, so nothing overlaps.

### Added
- **Animation tool — motion-framework output.** The Animate panel now emits idiomatic code for **CSS, Web Animations, GSAP, Framer Motion, and Motion One** from one spec, chosen via a sliding-thumb toggle. Includes a framework-adaptive **Spring** easing (real springs for Framer/Motion One, physics-ease approximation elsewhere) with stiffness/damping/mass.
- **Ctrl/Cmd+Shift+I toggles the app's DevTools** (Windows/Linux have no menu bar, so there was no built-in binding).

### Changed
- macOS notarization is now resilient — a stalled Apple notary can't hang the release; the build ships signed and notarizes when the service is healthy.

## [1.0.28] - 2026-07-08

### Added
- **Signed & notarized macOS builds** — the DMG/zip are now signed with a Developer ID certificate and notarized by Apple, so macOS opens them without the "damaged / unidentified developer" warning and no more `xattr -cr` dance. (Windows/Linux builds unchanged.)
- **Report a Performance Issue** (Settings menu) — captures diagnostics (per-process CPU/memory via `getAppMetrics`, GPU hardware-acceleration status, OS/CPU/RAM, live load, open sessions, recent console errors), with an optional 5-second sustained-CPU capture, and opens a pre-filled GitHub issue you review before submitting.

## [1.0.27] - 2026-07-07

### Added
- **Design-drift scanner** (new toolbar tool, Alt+D) — scans the page for hard-coded colors that are a near-miss to one of your design tokens (discovered from `:root` CSS custom properties) and should really use `var(--token)`. Lists each finding with a current-color → suggested-token swatch, previews the token live on the page when you check "Fix," flashes the element on hover, and sends the selected fixes to the agent. Phase 1 covers colors; spacing/type/radius and Storybook token sources come next.

## [1.0.26] - 2026-07-07

### Added
- **States inspector** — inside the Box/Lasso panel, each selected element's drawer has a sticky **States** row (`:hover · :focus · :active · :disabled`) that forces that element's pseudo-state live in the Browser (or a Storybook instance) via CDP, so you can inspect and edit states that are invisible in a static render. Per-element and independent; node IDs are cached per selection so a toggle reliably turns the state back off.

## [1.0.25] - 2026-07-06

### Fixed
- **New chat messages no longer dimmed by the bottom fade** — the bottom edge-fade now only appears once you've scrolled up past it, so the newest messages stay crisp regardless of split size, fullscreen, or the System/Usage panels reflowing the chat height.
- **Status banner reflects trailing agent activity** — if the agent keeps emitting after a turn resolves (seen on macOS), the banner re-lights "Working…" and auto-settles back to "Ready" so it can't get stuck.
- **Storybook URL clear (✕) button** was rendering as a full-size pill (a broad `.wf-panel-form button` rule outranked it) — scoped so it stays a small inline button.
- **Inline `code` chips were unreadable in light themes** — pinned their text color to the token matched to the chip's own background.

### Added
- **Slash-command acknowledgement** — a command that returns no chat output (e.g. `/usage`, which only refreshes the usage gauges) now leaves a small "✓ Ran /usage — no text response" note instead of appearing to do nothing.

## [1.0.24] - 2026-07-06

### Fixed
- **macOS: dark grays rendering too dark** — forced the sRGB color profile on macOS so the near-black shades (selected toggles/thumbs, panel backgrounds) render as authored, matching Windows. macOS was color-managing through the display's wide-gamut profile and crushing them toward black.
- **Chat messages landing inside the bottom fade** — new messages now scroll to the true bottom with clearance equal to the edge-fade height, so they sit fully visible above the fade instead of dimming out.
- **Uneven gap** between the restart button and the AUDIT dropdown — removed a stray margin so the header row is evenly spaced.

### Changed
- **"Working File" renamed to "Browser"** throughout the UI (empty states, onboarding, tool tour, agent prompts) to match the tab name.
- **Status bar is now stateful** — the whole bar turns green while the agent is working (success palette) and red on hover (the click-to-stop target).

## [1.0.23] - 2026-07-06

### Added
- **Syntax-highlighted code in chat** — fenced ` ``` ` code blocks in agent replies now render as styled blocks with Monaco syntax colors (the same vs-dark palette as the Code viewer, no new dependency), and `inline code` gets a chip. Streaming stays plain-text; highlighting is applied when the message completes.
- **Number-key shortcuts on permission prompts** — Allow/Always/Deny now show keycaps (Allow `1`, Always `2`, Deny `3`) and respond to pressing `1`/`2`/`3`.

### Changed
- **Save-prompt (bookmark) button** is now always visible next to Send — dimmed when the input is empty instead of disappearing entirely.

## [1.0.22] - 2026-07-06

### Fixed
- **Terminal view no longer hangs on "trust this folder?"** — switching a Claude session to the terminal view spawns interactive `claude`, which blocked forever on Claude Code's first-run workspace-trust prompt. Cathode now pre-accepts trust for the session's folder in `~/.claude.json` before launching (the chat/ACP path already bypasses this).

## [1.0.21] - 2026-07-06

### Fixed
- **Slash commands now execute** instead of being described by the model. The menu was a hardcoded list of Claude Code *CLI* commands (`/help`, `/login`, `/doctor`, `/cost`…) that do nothing in a headless ACP session, so sending them just prompted the model to explain them. The menu is now driven by the session's real `available_commands_update` (verified: the adapter advertises 27 genuinely-dispatchable commands like `/compact`, `/context`, `/usage`, `/review`, `/verify`), and picking one runs it.

## [1.0.20] - 2026-07-06

### Added
- **macOS logo curve** — restored the concave corner-curve on the left edge of the logo/settings seat, which now spans the window corner and contains the traffic lights.

### Changed
- **Agent tabs** — the kebab menu now leads the title (⋮ · name · ✕), tabs size to their content so full names like "Claude Code" are never clipped, and left padding is removed so the kebab hugs the edge.
- **Removed Aider and LLM CLI** — the agent lineup is now the four ACP-capable agents: Claude Code, OpenAI Codex CLI, Gemini CLI, and Hermes.
- **Onboarding** — "Meet the tools" cards regained their recessed card background, and the Setup / Meet-the-tools switch now uses the design-system sliding-thumb toggle.
- **About modal** — attribution updated to "by Hplant6".

### Fixed
- **Duplicate dropdown** — the Edit Tabs and MCP Connections modals no longer show a raw `<select>` stacked behind the styled custom dropdown.
- **Restart / new-session buttons** no longer bleed through the tool panels (Eyedropper, etc.); kept the spacing from the AUDIT cluster.

## [1.0.19] - 2026-07-06

### Changed
- **macOS chrome: logo/settings back on the left**, inside a structural container that now spans the window corner and *contains* the traffic lights (extra left padding clears them), so the lights read as part of the same seat. The bottom-right blob and the concave corner-curve on the right edge are back, matching the Windows chrome.

## [1.0.18] - 2026-07-05

### Added
- **macOS: real update flow** — "Check for Updates…" now queries the GitHub Releases API, compares versions, and (when newer) offers a Download button that opens the matching `.dmg` for your Mac's architecture (arm64 / x64). A dismissible "update available" toast also surfaces on launch. Replaces the broken "not a git checkout" dialog, since Squirrel.Mac auto-update needs code-signing.

### Fixed
- **macOS chrome: restored the concave curve** on the left edge of the right-hand logo/settings seat, so it meets the bar with the signature fillet instead of a hard angle.

## [1.0.17] - 2026-07-05

### Changed
- **macOS window chrome** — the logo + settings button now sit on the right side (the native traffic lights own the top-left), and the decorative corner-curve fillets around the window controls are dropped on macOS. Windows chrome is unchanged.

## [1.0.16] - 2026-07-05

### Fixed
- **macOS: nav tabs still overlapping** — a firmer fix for the tab bar. The width calculation now measures in viewport coordinates and falls back to natural tab width whenever the bar has room, so a collapsed boundary measurement can no longer squish the tabs into an overlapping sliver.

### Changed
- Removed the redundant native "Downloading update" dialog — the in-app progress modal covers it now.

## [1.0.15] - 2026-07-05

### Fixed
- **macOS: overlapping nav tabs** — the view-tab bar measured its right boundary from the window controls, which are hidden on macOS (native traffic lights), collapsing the width calculation and squishing every tab so their labels overlapped. It now falls back to the sysperf toggle when the controls are hidden.

## [1.0.14] - 2026-07-05

### Fixed
- **Auto-update now downloads and installs** — the Windows installer's filename contained spaces, which GitHub rewrites to dots on upload; electron-updater then requested a non-matching (hyphenated) URL and got a **404 on every download**, so updates never installed. The installer is now named `cathode-terminal-Setup-<version>.exe` (no spaces), so the download resolves. (This — not code-signing — was why auto-update never worked.)

## [1.0.13] - 2026-07-05

### Added
- **About Cathode** — Settings menu → *About Cathode* opens a modal with the Cathode logo, the current version, and author.

## [1.0.12] - 2026-07-05

### Fixed
- **Claude "Claude Code native binary … exists but failed to launch"** — a follow-up to the v1.0.11 WSL move: the ACP session was still handed a Windows `C:\…` working directory, which the Linux Claude Code can't `chdir` into, so it failed to launch. The session directory is now translated to its WSL `/mnt/…` path (confirmed end-to-end). Applies to every WSL-side agent.

## [1.0.11] - 2026-07-05

### Fixed
- **Claude "Internal error … Claude Code process exited with code 3" in the installed app** — the Windows-side ACP adapter bundles Claude Code as a Bun-compiled `claude.exe`, and that binary **segfaults** on some machines the moment it does real work (a plain prompt → "panic: Segmentation fault", exit 3). Cathode now runs the Claude adapter **inside WSL** — like Gemini/Codex/Hermes — using Claude Code's native `~/.claude` subscription, so it no longer touches the crashing Windows binary. (The earlier empty-key change was a red herring; the real cause was the crashing bundled executable.)

## [1.0.10] - 2026-07-05

### Changed
- Agent (ACP) errors now show the underlying error **code and detail** instead of a bare "Internal error," across the connect, spawn, and prompt paths — so agent failures can actually be diagnosed.

## [1.0.9] - 2026-07-05

### Added
- **Update progress modal** — auto-updates now show an in-app modal with a live download **progress bar** (transferred / total + speed) and a **Restart & Install** button, instead of downloading silently. Dismiss it and the download continues in the background; you'll get a clickable "ready to install" prompt when it finishes. (Packaged Windows/Linux only.)

## [1.0.8] - 2026-07-05

### Fixed
- **Claude "Internal error" in the installed app** — the packaged app (launched from the Start menu, so no `ANTHROPIC_API_KEY` in its environment) started the Claude ACP adapter with an **empty** API key, which overrode the signed-in subscription and made every prompt fail with "Internal error." The key is now only forwarded when it's actually set, so subscription/OAuth auth (`CLAUDE_CONFIG_DIR`) is used. Clearing an API key now removes it rather than setting an empty string. (Dev builds were unaffected because the shell already had a key.)
- Onboarding setup steps now render as visible cards — they had collapsed to the same shade as the modal, so each step's container was invisible.

## [1.0.7] - 2026-07-04

### Added
- **Scaffold a Storybook for a static HTML site** — the Storybook setup's "Use a framework" tab now has an **HTML / static site** option, so a plain HTML/CSS/JS project (e.g. a WordPress export) can be set up: the agent runs `storybook init --type html` and writes stories for the site's reusable UI blocks/sections.

### Changed
- The **Project folder** picker moved out of the Settings drawer to a persistent field under the Storybook setup tabs, so generating a Storybook from a folder is discoverable (still shared by the Run and Figma flows).

## [1.0.6] - 2026-07-04

Feature release: the Animation tool.

### Added
- **Animation tool** — target any element on a browsed page and build an animation request for the agent, with a **live preview** on the real element (Web Animations API):
  - **31 animation types** grouped as Entrance / Exit / Emphasis / Property (Fade, Slide, Zoom, Rotate, Flip, Bounce, Blur, Pulse, Shake, Wobble, Jello, Tada, Color, Size, Skew, and more).
  - **Easing** presets plus a **draggable cubic-bézier curve editor**; duration, delay, and contextual direction / distance / amount / target-color; repeat; and trigger (on load / scroll into view / hover / click).
  - **Loop the preview** (design-system checkbox) to tune an animation while it plays, without changing the Repeat value sent to chat.
  - **Send** drops a summary, the selector, and ready-to-adapt **CSS `@keyframes` and JS (Web Animations API)** starter code into the composer.
  - Styled to match the element (lasso) panel, with the app's iro color picker for the target color.

### Fixed
- Custom `<select>` dropdowns: options render readable on the menu surface, `<optgroup>` labels show as group headers, the menu caps to the viewport, and long lists scroll instead of clipping or squishing rows.

## [1.0.5] - 2026-07-04

Reliability & polish release: a full reliability audit, a clear-input control, a new app icon, dependency hardening, and a dead-code sweep.

### Added
- **Clear (X) button inside inputs** — the chat composer, address bar, Storybook URL, modal text fields, and the audit-prompt Label/Prompt now show an X to clear them (white on hover, no background change).
- Global crash backstops (`uncaughtException` / `unhandledRejection`) so one malformed IPC payload can't tear down the main process and kill every open session.

### Changed
- **New app icon** across Windows, macOS, and Linux (and the README).
- Dependencies: Electron 41.7.1 → 41.9.2 (Chromium security patch), the `undici` advisory cleared (`npm audit` → 0 vulnerabilities), and the unused `@xterm/addon-canvas` removed.
- The in-page color picker is now **inlined** into the injected script instead of loaded from a CDN, so it works on CSP-locked and offline pages.
- Agent detection on macOS probes through the **login shell agents actually run under**, so Homebrew/nvm-installed agents aren't falsely reported "not installed."
- Remaining raw-string IPC channels routed through the shared registry.

### Fixed
- **Reliability audit**: guarded sync IPC handlers against malformed payloads; kill-before-spawn so a double PTY spawn can't orphan a process; Monaco loaders no longer hang forever if their assets fail to load; wrapped Storybook/Code-Viewer IPC calls so a rejected handler can't leave the UI stuck; ACP early-failure no longer double-reports (a spawn error / early exit now clears the connect timeout); the `topProcs` buffer was raised so a large process table can't blank the CPU/RAM widget; inject overlays guard `document.body` for frameset / pre-body pages.
- The **eyedropper reticle** no longer vanishes on dark sites — page CSS was overriding its fill; it's now forced white with a thicker stroke and a drop-shadow so it reads on any background.
- **Tools reset on full page navigation** — a stale result panel from the previous page is now dismissed.
- Storybook demo detection tolerates a Unix-only `storybook` bin (node_modules installed from WSL).

### Removed
- ~470 lines of dead code — two abandoned inject files (standalone popup, screenshot popup), unused functions/exports/imports, and redundant boilerplate.

## [1.0.4] - 2026-07-03

Hardening release: four full audits (correctness, security, performance, maintainability) plus a new agent-safety gate.

### Added
- **Fable** in the Claude model menu.
- **Risky-tool confirmation** — the agent now asks before running shell / edit / delete / write / fetch tools (Allow / Always / Deny), instead of auto-approving everything. Read-only tools still run automatically. This is the safeguard against a prompt-injected page steering the agent into destructive actions.

### Fixed
- **Correctness** (~45 fixes across three tiers): model-switching via the tab menu (was blanking the pane and not switching), two boot-bricking corrupt-localStorage paths, an ArrowDown that erased an unsent draft, cancelled installs reporting success, a crash when closing the window mid-animation, duplicate tab ids, PTY-Enter racing a tab switch, stuck modal buttons on IPC failure, and more.
- **Security**: closed an auth-modal XSS→RCE path, validated the Storybook port (command-injection sink) and sanitized the agent-env probe, and made the plaintext-secret fallback warn instead of downgrade silently.
- **Performance**: fixed a custom-`<select>` document-listener leak plus two smaller resolver/command-map leaks; throttled per-chunk and per-frame reflows in chat streaming and tool output; paused background PowerShell process-polling when unfocused.

### Changed
- Internal maintainability: routed raw channel + localStorage string literals through their registries, unified the split-divider gutter into one constant (fixes a 1px popup-alignment drift), and corrected the box-select overlay-skip guard.

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

[Unreleased]: https://github.com/hplant6/cathode-terminal/compare/v1.0.17...HEAD
[1.0.17]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.17
[1.0.16]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.16
[1.0.15]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.15
[1.0.14]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.14
[1.0.13]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.13
[1.0.12]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.12
[1.0.11]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.11
[1.0.10]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.10
[1.0.9]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.9
[1.0.8]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.8
[1.0.7]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.7
[1.0.6]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.6
[1.0.5]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.5
[1.0.4]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.4
[1.0.3]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.3
[1.0.2]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.2
[1.0.1]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.1
[1.0.0]: https://github.com/hplant6/cathode-terminal/releases/tag/v1.0.0
