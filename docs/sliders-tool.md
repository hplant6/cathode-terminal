# Sliders tool

Status: built 2026-09-25 (M1 core, plus token snapping, presets, compare and the page-vars starter). Full spec: the "Gamut Toolbox — Slider Tool Spec" doc.

A live tuning panel for the page in the browser pane. An agent (or **From Page Vars**) writes a panel file. The user drags values, and **Send** hands the changed values back to the agent to bake into the code.

## Files

| File | Role |
| --- | --- |
| `src/sliders.js` | Main side: list/validate/save panel files, URL matching, the bake message, the agent-instruction lines |
| `src/sliders-inject.js` | Page runtime `window.__gamutSliders`: `load`, `apply`, `unload`, `overlay`, `layout`, `drain`, `scanVars` |
| `main.js` (`// ── Sliders tool`) | IPC handlers, re-apply on `did-finish-load`, 1.5s async poll of `.cathode/sliders/` |
| `src/renderer.js` (`initSlidersPanel`) | The left-column panel: rows, per-frame batching, presets, compare, copy/paste, auto-open |
| `src/index.html` / `src/styles.css` | `#btn-sliders`, `#sliders-panel`, `.sl-*` styles (reuses `.pp-field`, `.rz-slider`, `.vt-switch`) |

## Panel file

`<project>/.cathode/sliders/<id>.json`:

```json
{ "title": "Hero glow", "match": "/", "controls": [
  { "group": "Glow" },
  { "k": "size", "label": "Size", "type": "range", "min": 0, "max": 80, "step": 1, "def": 24, "unit": "px",
    "bind": { "css": "--glow-size", "on": ".hero" }, "source": "src/hero.css:12" },
  { "k": "gap", "type": "range", "min": 0, "max": 64, "def": 16, "unit": "px",
    "tokens": { "--space-2": 8, "--space-4": 16, "--space-8": 32 }, "bind": { "css": "--gap" } },
  { "k": "bloom", "type": "range", "min": 0, "max": 3, "step": 0.01, "def": 0.8, "bind": { "path": "APP.bloomPass.strength" } },
  { "k": "cam", "type": "vec3", "min": -10, "max": 10, "def": [0, 1.5, 6], "bind": { "path": "APP.camera.position" } },
  { "k": "replay", "label": "Replay intro", "type": "button" }
], "presets": { "Subtle": { "size": 12 } } }
```

- `type` is inferred when missing: boolean → toggle, `#hex` → color, array → vec, `options` → select, else range.
- `bind.path` must be a dotted path; it is walked, never evaluated. A control with a bad bind is dropped and reported in the panel's error box.
- No `bind` → `event`: `addEventListener('gamut:slider', e => { const { k, value } = e.detail; … })`.
- `match`: a path glob (`/work/*`) or a full-URL glob (`http…`); omitted → every page.

## Behaviour notes

- **Two surfaces.** The sliders float over the page itself: a shadow-DOM panel from `installOverlay` in `sliders-inject.js`, themed with the app's `--spec-*` colours. The tool column is set-up: panel choice, **Position** (top left/right, bottom left/right), **Transparency** (the panel fill; the backdrop blur fades with it), show/hide, presets and Send. It holds the same rows too. A drag on the page panel applies in the page directly and is queued; main drains the queue every 120ms (`SLIDERS_PAGE_CHANGES`) so the column's rows follow. Layout is remembered app-wide (`gamut-sliders-layout`).
- **Sample panel.** With no panel files (or no project), a made-up panel with random values opens, so there is always something to preview. Its controls are event-only, they appear only on the page (the column shows just the instructions and Preview set-up), and Send is disabled. A real panel file appearing replaces it.

- **Cancel** restores the page: path binds get their `def`, and the CSS properties are removed. Tuned values are remembered per panel (localStorage) for the next open.
- **Send** leaves the page as tuned and clears the remembered values. The bake message asks the agent to update each `def` in the file, so the panel follows the code.
- **Auto-open**: a new panel file opens the panel, unless a pick mode or another tool panel is active; then `#btn-sliders` gets a dot.

## Not built yet (from the spec / recommendations)

- Hand-built controls via the element picker (M3)
- three.js auto-discovery via `__THREE_DEVTOOLS__`
- Oscillate a value, shuffle with locks, per-breakpoint values, per-control frame cost, MIDI
