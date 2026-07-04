# Animation Tool — Design Spec

Status: **approved for build** · Target: robust, first-class element-targeting tool.

## Concept
A new page tool: activate it, click an element, and a panel takes over the chat
column with animation controls. Every change **plays live on the real element**
(Web Animations API). **Send** composes an implementation-ready request into the
chat composer — including generated **CSS *and* JS starter snippets** — for the
agent to build into the project's code.

Structurally it's the resize tool with a richer control set:
`PICK_ANIMATE` → inject targets an element → `ANIM_PANEL_OPEN` → panel →
live `preview(spec)` calls → **Send** composes chat text → revert + close.

## User flow
1. **Alt+N** / toolbar / right-click menu → arm; elements highlight on hover.
2. **Click** an element → locks as target; panel opens showing it (`div.hero-card`).
3. Configure → each change **replays the animation live** on the element.
4. **Replay** button re-runs; **Reset** reverts the element to untouched.
5. Optional free-text notes in the footer textarea.
6. **Send** → composer filled with request (selector + spec + CSS & JS snippets +
   notes); element reverted; tool closes.

## Animation catalog (robust — grouped in the "Animate" dropdown)
**Entrance:** Fade In · Slide In · Zoom In · Rotate In · Flip In (X/Y) · Bounce In ·
Blur In · Fade+Slide combos (Fade In Up/Down/Left/Right)
**Exit:** Fade Out · Slide Out · Zoom Out · Rotate Out · Flip Out · Blur Out
**Emphasis (loopable, in place):** Pulse · Bounce · Shake · Wobble · Swing · Tada ·
Jello · Flash · HeartBeat · Rubber Band · Spin
**Property transitions (→ target value):** Color · Background · Size/Scale · Rotate ·
Skew · Blur · Opacity · Border-radius

## Panel controls
Rows are `label left · control right`, reusing `.ct-select` and the chat-font
slider pattern. Contextual fields show/hide by animation type.

| Field | Control | Applies to |
|---|---|---|
| **Animate** | grouped dropdown | all (the catalog above) |
| **Easing** | dropdown | all — linear/ease/in/out/in-out + back/bounce/elastic presets + custom cubic-bezier |
| **Duration** | slider + number (ms, default 1000) | all |
| **Delay** | number + optional slider (ms, default 0) | all |
| **Direction** | dropdown (Up/Down/Left/Right) | Slide/Zoom/Flip/Rotate |
| **Distance** | slider + input (px/%) | Slide |
| **Amount** | slider + input (scale× / deg / px) | Size/Rotate/Skew/Blur |
| **Target color** | iro swatch | Color/Background |
| **Repeat** | toggle → Once / Infinite / N | all |
| **Trigger** | dropdown | On load · On scroll into view · On hover · On click |
| **Fill** | dropdown (forwards/none) | advanced; default forwards |

The footer textarea covers anything the dropdowns don't (custom trigger logic,
stagger, chaining, framework specifics).

## Animation spec (single model — drives preview AND chat output)
```js
{ selector, elementDesc,
  type,        // fade-in | slide-in | zoom-in | ... | color | size | rotate | ...
  easing, duration, delay,           // css timing fn, ms, ms
  direction, distance,               // slide/flip/zoom
  amount, targetColor,               // property transitions
  repeat,                            // 1 | 'infinite' | N
  trigger, fill }                    // load|scroll|hover|click ; forwards|none
```

## Live preview — Web Animations API
Inject exposes `window.__cathodeAnim.preview(spec)` / `.revert()`.
`element.animate(keyframes, opts)` is revertible (cancel + restore inline style),
needs no injected `<style>`, and maps 1:1 to the spec. `revert()` restores the
element on cancel/send so the page is untouched. Scroll/hover/click triggers just
**play immediately** in preview — the trigger only affects the emitted code.

## Chat output — CSS **and** JS starter, agent adapts
Emit both, tagged, so the agent picks what fits the project (vanilla / React /
Tailwind / framer-motion / GSAP):
```
Animate `div.hero-card`: Slide In from left 600px, 800ms, ease-out, delay 100ms,
trigger: on scroll into view, play once.

/* CSS */
@keyframes slide-in-left { from{opacity:0;transform:translateX(-600px)} to{opacity:1;transform:none} }
.hero-card { animation: slide-in-left 800ms ease-out 100ms both; }
/* scroll trigger: add via IntersectionObserver, or a `.in-view` class toggle */

// JS (Web Animations API)
el.animate([{opacity:0,transform:'translateX(-600px)'},{opacity:1,transform:'none'}],
  { duration:800, delay:100, easing:'ease-out', fill:'forwards' });
// trigger: new IntersectionObserver(([e])=>e.isIntersecting && play()).observe(el)

<user's free-text notes>
```

## Architecture — files & IPC (follows the existing tool pattern)
- **`src/tools.js`** — `{ key:'n', id:'btn-pick-animate', label:'Animate', group:'project', menu:true, desc:'…' }`
- **`src/animation-inject.js`** *(new)* — page script: hover-target + marching-ants
  highlight (reuse `inject-shared` selector helper), lock on click, report element;
  `window.__cathodeAnim.preview/revert`.
- **`src/index.html`** — `#animation-panel .tool-panel` + toolbar button (the
  provided icon, fills → `currentColor`).
- **`src/styles.css`** — panel rows reusing `.ct-select` / slider / toggle styles.
- **`src/renderer.js`** — `initAnimationPanel()`: wire selects, sliders, conditional
  fields, debounced live-preview, Replay/Reset, Send (compose CSS+JS → composer),
  Cancel.
- **`main.js`** — `PICK_ANIMATE` (inject + target flow), `animExec()` relay for
  `ANIM_PANEL_PREVIEW/REVERT`, `ANIM_PANEL_OPEN` back to renderer.
- **`src/ipc-channels.js`** — `PICK_ANIMATE`, `ANIM_PANEL_OPEN/PREVIEW/REVERT/SEND/CANCEL`.

## Design-system reuse (no new primitives)
`.ct-select` (dropdowns), chat-font slider (duration/delay/distance/amount),
existing toggle (repeat/trigger), `.tp-head/.tp-body/.tp-foot/.pp-btn-*` panel
scaffolding, iro swatch (target color), tool-panel lifecycle (Escape + nav-reset
already dismiss it).

## Build phases
1. **Skeleton** — tool registration + icon + targeting + panel opens with element
   info + Send composing a plain description. *Proves the pipeline end-to-end.*
2. **Core + live preview** — Fade / Size / Color + easing/duration/delay via WAAPI,
   conditional fields, CSS+JS snippet generation.
3. **Full catalog** — all entrance/exit/emphasis/property types, direction/distance/
   amount, repeat, trigger, fill; easing presets + custom bezier.
