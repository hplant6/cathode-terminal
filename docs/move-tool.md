# Move Tool — Design Spec

Status: **phases 1–2 + most of 3 built** (live preview not built) · Target: first-class element-targeting tool.

## Concept
A new page tool for *layout intent*: select an element, drag an **arrow** from it
to where it should live, repeat for as many elements as you like, then **Send** one
batched request to the agent. The page itself is not rearranged (by default) — the
arrows *are* the request, drawn over the live page so the intent is unambiguous.

Structurally it's the animate tool's multi-target session plus a drag gesture:
`PICK_MOVE` → inject arms the page → user builds moves (arrows) → inject reports
each move → `MOVE_PANEL_UPDATE` keeps the panel list in sync → **Send** composes
chat text → overlay cleared → tool closes.

## User flow
1. **Alt+V** / toolbar / right-click menu → arm; elements highlight on hover
   (same hover outline as the other pick tools).
2. **Click** an element → it's selected (marching ants). **Shift+click** adds more
   to the selection; Shift+click a selected one removes it.
3. **Drag** from any selected element → an arrow follows the cursor from the
   element's edge. The drop target under the cursor highlights with an
   **insertion indicator** (see *Drop resolution*).
   - Shortcut: press-and-drag on an *unselected* element selects it and starts the
     arrow in one gesture.
4. **Release** → the move is recorded: a numbered arrow (①②③…) stays pinned on the
   page, and a row appears in the panel. Selection clears, ready for the next move.
5. Repeat 2–4 for more moves. Arrows stay anchored to their elements through
   scrolling and window resizes.
6. Optional per-move note (panel row) and an overall note (footer textarea).
7. **Send** → composer filled with the batched request; overlay cleared; tool closes.
   **Cancel** / Escape (with nothing mid-drag) → discard everything.

### Multiple selection → group move
If several elements are selected when you drag, it's **one move with a group
source**: one arrow (from the group's bounding box, badge shows `①×3`), meaning
"move these together, keep their relative order". Separate moves = separate drags.

## Drop resolution — what "a location" means
The drop point resolves to a **structural anchor**, not raw coordinates — that's
what the agent can act on in source code.

- The deepest valid element under the cursor is the **reference**.
- Where in the reference you release picks the **placement**, following the flow
  direction of the reference's *parent* (`flex-direction` / grid auto-flow / block
  vs inline):
  - leading 30% of the box (top for column flow, left for row flow) → **before**
  - trailing 30% → **after**
  - middle 40%, and only if the reference can hold children → **inside** (as last
    child); otherwise middle snaps to the nearer of before/after.
- Indicator: a 2px accent insertion line for before/after; a dashed accent box for
  inside. Parent gets a faint outline so the context is visible.
- **Invalid drops** (onto the source itself, into its own descendant, onto
  `html`/`body` edges, into iframes/shadow roots it can't read) → arrow turns
  `--danger`, drop is rejected.
- **Nudge modifier:** hold **Ctrl** (⌘ on macOS) on release → record a **pixel
  offset** instead (`dx, dy`, same parent) for "shift this over a bit" requests.
  Arrow renders dashed to distinguish it.
- Auto-scroll when dragging within 40px of the viewport edge, so long pages work.

## Overlay rendering (in-page, inject script)
- One fixed-position SVG layer at the tools' z-index (`Z` from `ui-constants`),
  `pointer-events: none` except while armed.
- Arrow: source edge → drop point, rounded curve (quadratic, bows away from
  straight lines so overlapping arrows stay readable), accent stroke, arrowhead,
  numbered badge at the source end. Colors from the theme tokens injected into the
  page like the other tools (no hard-coded oranges — see the tokenization note in
  the theming work).
- Anchoring: each move stores element refs + relative offsets; endpoints recompute
  from `getBoundingClientRect()` on `scroll`/`resize` (rAF-throttled).
- **Stale moves:** if a source or reference element leaves the DOM (HMR re-render),
  try to re-find it by selector; if that fails, mark the row *stale* (dimmed, warn
  icon) — it's still sent, flagged, since the selector + snippet are captured.
- Hover an arrow or its panel row → both highlight. Click an arrow → select it;
  **Delete/Backspace** removes it. **Ctrl+Z** removes the last move.

## Panel (chat column, `.tool-panel`)
```
MOVE                                   [Clear all]
① button.cta            → after  h2.hero-title      ✕
   in section.hero                     [note…]
② ×3 li.nav-item        → inside ul.footer-links    ✕
③ img.logo              ↔ nudge 24px right, 8px up  ✕
──────────────────────────────────────────────────
[overall note textarea]                 Cancel  Send
```
Rows are selector (source) → placement + reference, parent context on the second
line, per-row note field, remove button. Empty state: "Select an element, then
drag it to where it should go."

## Chat output
Same envelope as Resize/Animate (`PICK_SEND_TO_SESSION` with `detail` + `body`):
```
───── Move Request (3) ─────
From <page source> — <url>

1. Move: button.cta
   <button class="cta">Get started</button>
   From: inside div.actions (child 2 of 3), in section.hero
   To:   after h2.hero-title, inside section.hero
   Note: <per-move note>

2. Move together (keep order): li.nav-item ×3
   …
   To:   inside ul.footer-links (as last child)

3. Nudge: img.logo — 24px right, 8px up (keep its parent)

Update the source so these elements render in the new positions. Apply the moves
in order. Prefer changing markup/component order over absolute positioning;
adjust layout CSS only where the new position needs it.
```
Each entry carries selector + trimmed `outerHTML` snippet (the `getSelector` /
160-char snippet the other tools already use) for both source and reference.

**Phase 2 addition:** attach a screenshot of the viewport *with the arrows drawn*
(reuse the screenshot tool's capture path) — one image makes a multi-move request
far less ambiguous for the agent.

## Architecture — files & IPC (follows the existing tool pattern)
- **`src/tools.js`** — `{ key:'v', id:'btn-pick-move', label:'Move', group:'project', menu:true, desc:'Drag elements to new spots and send the moves to chat' }`
- **`src/move-inject.js`** *(new)* — page script: hover/select/multi-select, drag
  gesture, drop resolution, SVG arrow overlay, anchoring, keyboard; exposes
  `window.__cathodeMove.moves()/remove(i)/clear()`. Uses `inject-shared`
  (`getSelector`, `esc`).
- **`src/index.html`** — toolbar button (the provided icon) + `#move-panel .tool-panel`.
- **`src/styles.css`** — panel rows reusing tool-panel scaffolding.
- **`src/renderer.js`** — `initMovePanel()`: render list, per-row notes/remove,
  hover sync, Send/Cancel/Clear all.
- **`main.js`** — `PICK_MOVE` (inject + session), relay of move updates to the
  renderer (same poll/relay approach the resize tool uses for live dims),
  `MOVE_PANEL_SEND` composes the chat text, `MOVE_PANEL_CANCEL` clears.
- **`src/ipc-channels.js`** — `PICK_MOVE`, `MOVE_PANEL_OPEN/UPDATE/REMOVE/HOVER/SEND/CANCEL`.

No OS-specific code: everything lives in the page and renderer. The Ctrl/⌘ nudge
modifier follows the platform guard; check that Alt+V fires on macOS (Option+V
types `√`) the same way the other Alt shortcuts do.

### Icon
`24-drag-right.svg`: the circle is the element, the arrow is the move, which fits.
To match the other 18px toolbar icons: `fill`/`stroke` → `currentColor`, render at
18×18 (keep the 24 viewBox), and raise `stroke-width` to ~1.6 so it doesn't look
thinner than its 1.25-on-18 neighbours. Clean up the redundant `L21 12` segment.

## Design-system reuse (no new primitives)
Tool-panel scaffolding (`.tp-head/.tp-body/.tp-foot/.pp-btn-*`), the shared
composer bar on the footer textarea (`decorateToolInstruction`), the existing hover
outline and marching ants, and accent/danger tokens. Escape and navigation reset
already close tool panels, and Move uses the same lifecycle.

## Build phases
1. **Skeleton**: register the tool and icon, single select, drag arrow, before/after
   drops only, one move, and Send composes the request. *Proves the pipeline end to end.*
2. **Multi**: multiple moves with numbered pinned arrows, the panel list with
   remove/notes, Shift multi-select group moves, the `inside` placement,
   flow-direction awareness, invalid drops, auto-scroll, and the annotated screenshot.
3. **Polish**: nudge modifier, stale-element handling, arrow selection with
   Delete/Ctrl+Z, arrow↔row hover sync, and an optional **live preview** (see Q2).

## Decisions (defaults taken at build time; revisit if they feel wrong in use)
1. **Drop meaning:** structural (before/after/inside) by default; Ctrl/⌘ on release = pixel nudge.
2. **Live preview:** not built. Arrows only.
3. **Shortcut:** Alt+V.
4. **Screenshot:** panel checkbox, on by default. Captures the visible viewport with the arrows drawn.
5. **Arrow selection:** the numbered **badge** is the click target, not the arrow line.
   A hit area along the whole line blocked drags on the elements it crossed.
6. **Shift during drag** drops on the hovered element's parent. That's the escape hatch
   when the deepest element under the cursor is too specific (an inline span, an icon).
7. **Snap | Drag switch** sits on the page just under the current selection, where you're
   about to drag. **S** flips it too, and the choice is remembered. Snap resolves drops to
   before/after/inside. Drag points the arrow at any spot. The request then gives the offset
   from the element's centre, the page point, and the element under that point, and the
   screenshot carries the intent. The switch hides mid-drag and in the screenshot.
8. **Selection look** matches Box select: padded marching-ants box with the glow and an
   orange name tag. Hover uses the same outline and tag.
9. **Drag from anywhere.** While there's a selection, a drag anywhere on the page draws the
   selection's arrow, so a press just outside the element no longer grabs its neighbour.
   A click without dragging selects what's under it; with nothing selected, press-and-drag
   selects and moves in one go. Cues: the grab cursor everywhere while something is selected; a solid-ring
   hover (not dashes and a tag) on other elements; `· drag to move` on the selection tag
   until the first move; and the arrow appears from the first pixel of movement.
