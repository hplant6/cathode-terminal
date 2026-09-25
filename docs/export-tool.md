# Export — Design Spec

Status: **phases 1–2 built** (without Copy / Attach to chat, which were cut) · phase 3 not built · Target: save what's in the browser as PNG, JPG or PDF.

## Concept
A **camera/export button** beside the address bar. Clicking it opens an **Export** dialog:
pick a **format** (PNG · JPG · PDF), an **area** (what's on screen, or the entire page),
and a few options, then **Export** saves the file. The button exports whatever page the right
panel is showing: a project tab, Storybook or a custom URL view (`getActivePickView()`).

Export is not the Screenshot *tool* (`ss-panel`). That tool annotates a shot and sends it to
the agent. Export produces a file for people. The two share capture code, and Export
gets an optional **Attach to chat** destination so the paths still meet (see *Destinations*).

## User flow
1. Click **Export** (or **Ctrl+Shift+E**; ⌘⇧E on macOS). The button is disabled when the page is blank.
2. The button **grabs the visible viewport at once**, before the dialog opens, and the
   dialog shows it as a preview. It has to happen at click time: every open modal parks
   the native page view offscreen at 1×1 (`MODAL_OVERLAY`), so there's nothing to capture
   once the dialog is up.
3. The dialog opens. Choose the format, the area and the options. The preview and an
   **estimated output size** (e.g. `1440 × 9,812 px · ~6.1 MB`) update as you go. Choices
   are remembered for next time.
4. **Export** → the dialog closes, which brings the view back → the page is captured
   (full page and element captures run now; visible can reuse the click-time frame) →
   native **Save** dialog, with the name and folder pre-filled → the file is written → toast
   `Saved to …` with **Show in folder** / **Open**.
   - While a full-page capture runs, the address bar shows a thin progress state.
     **Esc** cancels.
5. Holding **Shift** while clicking the button (or pressing Ctrl+Shift+E twice) skips the dialog: it re-runs the last
   export straight to the last folder with a fresh timestamp. This makes repeated shots
   one keystroke.

## Dialog layout
One `.modal-backdrop` modal in the house style (the conventions in the modal alignment
pass: orange not blue, Zalando uppercase buttons, shade-6 cards). It has two columns:

| Left: preview | Right: options |
|---|---|
| The click-time frame, scaled to fit. The full-page option shows a tall "page strip" hint (see Open question 3). | Format · Area · Scale · format-specific options · Destination · Filename |

Footer: **Cancel** · **Export** (primary). The Export label shows the destination, e.g.
`EXPORT PNG` or `COPY TO CLIPBOARD`.

## Options

### Format
- **PNG**: lossless. Offers **Transparent background** (useful for Storybook components).
- **JPG**: a **Quality** slider (default 90) and **Background** (white / page colour), since
  JPG has no transparency.
- **PDF**: two kinds, because "PDF of a web page" means two different things:
  - **As on screen** (default): the capture embedded in a PDF at its exact size, one
    tall page (see *Implementation*) or split into pages. It looks exactly like the
    screen. The text can't be selected.
  - **Printable**: `webContents.printToPDF()`. Vector output with selectable, searchable text and
    links, but it uses the page's print CSS and pagination, so it can look different.
    Options: **Paper** (Letter / A4 / Legal / Tabloid), **Orientation**, **Margins**
    (none / default / wide), **Background graphics**, **Header & footer** (URL + date +
    page numbers). The Area and Scale options don't apply and are hidden.

### Area
- **Visible**: exactly what's on screen, at the current device-emulation size (a
  375-px iPhone viewport exports at 375 wide).
- **Full page**: the whole scrollable document.
- **Element**: arms a picker (the same hover outline as the pick tools). Clicking an
  element captures its bounding box, plus **Padding** (0 / 8 / 24 px). This is great for exporting a
  single component or section. *(Phase 3)*
- **Selection**: if a Box/Lasso selection is open, export just that box. *(Phase 3)*

### Scale
**1×** · **2×** (default on a HiDPI screen) · **3×**. Scale means device pixels per CSS pixel,
so a 2× export of a 1440-wide page is 2880 px wide. It's implemented as a `deviceScaleFactor`
override, so the page re-renders sharply rather than being upscaled.

### Full-page options
- **Load lazy content first** (default on): scroll the page top→bottom in viewport steps,
  wait for images to load, then return to the top before capturing. Without it, lazy
  images and scroll-reveal sections come out blank.
- **Max height**: default 20,000 CSS px. This protects against infinite-scroll feeds. Past
  the cap, the page is cut and the toast says so.
- **Hide fixed & sticky elements after the first screen**: off by default. It's for pages
  whose floating headers or chat bubbles stamp across the capture.

### Clean-up (all formats, default on)
- **Hide Gamut overlays**: selection outlines, Move arrows, marker ink, eyedropper
  loupe and the like, so our own tools never end up in an export.
- **Hide scrollbars**.
- **Pause animations**: freeze CSS animations/transitions and `<video>` at the current
  frame so a capture isn't taken mid-fade. *(Phase 2)*

### Delay
**None** · **3 s** · **5 s**. The capture waits after the dialog closes, for a hover
state, an open menu or a toast. A countdown shows in the address bar. *(Phase 2)*

### Destination
- **Save to file** (default): native Save dialog.
- **Copy to clipboard**: images only (`clipboard.writeImage`). There's no Save dialog; the toast says
  `Copied`.
- **Attach to chat**: saves to the app's temp exports folder and drops it into the
  composer as an inline file chip (the new chip editor), ready to type around. This
  replaces the "screenshot → then attach it" round trip.

### Filename
The pattern defaults to `{title}_{yyyy-mm-dd}_{HHmm}` plus `_full` / `_2x` when relevant, and is
editable in the dialog. Tokens: `{title}` (the page title, cleaned up for use as a filename), `{host}`,
`{path}`, `{device}` (the device-emulation name), `{w}x{h}`, `{date}`, `{time}`. The folder
defaults to the last one used for each project, falling back to `Pictures/Gamut`.

## Implementation

### Where the button goes
In `#tab-bar`, between `#btn-reload` and `#btn-device`: an icon button (18px house
icon) with the tooltip `Export page (Ctrl+Shift+E)`. It is hidden when the right panel has
no page view (same condition that greys out the pick tools, `tools-inactive`).

### IPC (new, in `ipc-channels.js`)
| Channel | Direction | Purpose |
|---|---|---|
| `EXPORT_PREPARE` | renderer → main (invoke) | Grab the visible frame + metrics **before** the modal opens. Returns `{ previewDataUrl, viewport:{w,h,dpr}, content:{w,h}, title, url, device }`. |
| `EXPORT_RUN` | renderer → main (invoke) | Run the chosen export after the modal closes. Returns `{ ok, filePath?, copied?, truncated?, error? }`. |
| `EXPORT_PROGRESS` | main → renderer | `{ phase: 'lazyload'|'capture'|'stitch'|'write', pct }` for the address-bar progress state. |
| `EXPORT_CANCEL` | renderer → main | Esc during a run. |

### Capture engine (main, new `src/export.js`)
- **Visible**: `view.webContents.capturePage()` at the `EXPORT_PREPARE` step, the same call
  the eyedropper and marker already use. For a non-1× scale, the CDP path below is used
  with `clip` = the viewport.
- **Full page**: CDP through `webContents.debugger`:
  1. `Page.getLayoutMetrics` → `cssContentSize`.
  2. `Emulation.setDeviceMetricsOverride({ width: viewportW, height: viewportH,
     deviceScaleFactor: scale, mobile })`. This pins the layout to the size the user actually saw,
     however the view is currently sized.
  3. `Page.captureScreenshot({ format, quality, captureBeyondViewport: true,
     clip: { x:0, y, width, height: tileH, scale: 1 } })` in **tiles**. A single GPU
     surface tops out around 16,384 px, so tall pages go in tiles of ≤ 8,192 device px
     and are stitched together.
  4. `Emulation.clearDeviceMetricsOverride`, and restore the scroll position.
- **Stitching**: in the renderer, on an `OffscreenCanvas`. There is no native image dependency
  (no `sharp`, so there's nothing to rebuild on Windows; see the npm-from-Windows rule).
  Canvas limits: 32,767 px on a side and about 268 M px in total. Past that, the image
  formats cap the height and offer **PDF (as on screen)**, which has no such limit.
- **Transparent PNG**: `Emulation.setDefaultBackgroundColorOverride({ color: {r:0,g:0,b:0,a:0} })`
  for the capture.
- **Overlays / scrollbars / animations**: inject a temporary `<style id="__gamut-export">`
  that hides our overlay roots and `::-webkit-scrollbar`, and sets `animation-play-state:
  paused`. It is removed in a `finally`. The overlays mostly already use `__cathode_*` ids
  (`__cathode_hl__`, `__cathode_selection__`, `__cathode_draw_overlay__`,
  `__cathode_shot__`, …). The phase 1 task is to give every overlay root one shared
  `data-gamut-overlay` attribute (Move's arrows included) and hide by that attribute. A
  blanket `[id^="__cathode_"]` would also hide **`__cathode_edit_css__`, the user's live
  CSS edits**, which *should* show in an export.

### PDF
- **As on screen**: no PDF library needed. Load a tiny HTML page holding the stitched image
  into a hidden, offscreen `BrowserWindow` and call `printToPDF({ pageSize: { width, height }
  (inches, from px ÷ 96), margins: none, printBackground: true })`. Chromium caps a page at
  about 200 in (≈19,200 CSS px), so longer captures split into several pages at that
  height. If that proves fragile, fall back to `pdf-lib` (pure JS, installed from Windows).
- **Printable**: `view.webContents.printToPDF({ pageSize, landscape, margins,
  printBackground, displayHeaderFooter, generateDocumentOutline: true })` directly on the
  page.

### DevTools conflict
`ensureCDP()` refuses to attach while DevTools is open (`debugger.attach()` conflicts with the
DevTools session). While DevTools is open:
- **Visible** at 1× still works (`capturePage`, no debugger).
- **Full page / scaled / transparent** fall back to **scroll-and-stitch**: scroll by one viewport,
  `capturePage()`, repeat, stitch. Sticky headers would repeat, so the fixed/sticky option is forced on.
  The dialog notes `DevTools is open — using compatibility capture`.

### Persistence
Stored in `localStorage` under `LS.exportPrefs`: format, area, scale, JPG quality, PDF settings,
toggles, delay and filename pattern. The last folder is stored per project in the `.cathode` manifest
(`exportDir`) so exports follow the project folder.

## Edge cases
- **Inner scroll containers** (apps whose `body` is `100vh` with an `overflow:auto` main
  pane): full page = one screen. Detect it (the document is no taller than the viewport, but a
  descendant has `scrollHeight > clientHeight` covering most of the viewport) and offer
  **Capture the scrolling panel**, which expands that element for the capture. *(Phase 3;
  Phase 1 notes the limitation in the toast.)*
- **`100vh` heroes**: the viewport override keeps them at the real screen height, so they don't
  stretch to the page height. Verify this in the spike.
- **Cross-origin iframes**: captured as rendered (the compositor draws them), but they are not
  scrolled by the lazy-load pass.
- **Blank / error pages, `about:blank`**: button disabled.
- **Device emulation**: exports use the emulated viewport, not the panel size. `{device}` in the
  filename says which one.
- **Figma view**: allowed, but it is a canvas app. Full page = visible, and the Area control says so.
- **Huge outputs**: estimated size over 50 MB → the Export button shows a warning line before
  you commit.

## Phases
1. **Core**: button, dialog, PNG/JPG, Visible + Full page (CDP tiles + stitch), Scale,
   lazy-load pass, overlay/scrollbar clean-up, Save dialog + toast, remembered prefs,
   DevTools fallback.
2. **PDF + extras**: both PDF kinds, Copy to clipboard, Attach to chat, Delay, Pause
   animations, filename pattern, Shift-click quick re-export.
3. **Targeted areas**: Element, Selection, scrolling-panel capture.
4. *(Later / if wanted)* **Breakpoint batch**: one export at several widths (375 / 768 / 1440)
   as separate files or one side-by-side sheet; **device frame** around mobile captures.

## Spike first (½ day, before phase 1)
Prove the risky parts in isolation (headless Playwright, as for Move):
- `captureBeyondViewport` + `setDeviceMetricsOverride` on a 12,000-px page: stitch seams,
  sticky header drawn once, `100vh` hero not stretched.
- Capture timing when the view has just come back from the 1×1 offscreen park. We may need
  to wait a frame (`requestAnimationFrame` round trip) before capturing.
- Image-PDF via a hidden window with a 150-in page.

## Open questions for Henry
1. **Button look:** an icon-only button (like reload), or icon + `EXPORT` label (like
   `RESPONSIVE`)?
2. **Default area:** Visible or Full page?
3. **Preview for Full page:** the preview can only show the click-time screen. That's fine,
   or should the dialog run a quick low-res full-page pass to preview the real thing (costs
   ~0.5–2 s when the dialog opens)?
4. **Attach to chat / Copy:** are these in scope for phase 2, or should they be cut to keep this a pure
   file export?
5. **Shortcut:** is Ctrl+Shift+E OK? It's free in the app today, but some pages bind it.

## Decisions (review, 2026-09-25)
1. **Button:** icon plus `EXPORT` label, styled like `RESPONSIVE`; icon `24-image-3`.
2. **Default area:** Full page.
3. **Preview:** a real full-page preview. It is taken *before* the dialog opens
   (`EXPORT_PREPARE`, low-res CDP pass ~360 px wide), because the modal parks the view. The
   button reads `Preparing…` meanwhile.
4. **Copy to clipboard / Attach to chat:** cut for now.
5. **Shortcut:** Ctrl+Shift+E. It opens the dialog, and pressing it again while the dialog is open exports.

## As built: differences from the spec above
- **Engine:** `src/export.js`, which works on a small target adapter, so the spike tests drive the same
  code through Playwright's CDP session. The spike confirmed:
  - a `100vh` hero keeps its screen height
  - sticky elements are drawn once
  - 8,192-px tile seams don't show
  - overlays are hidden
  - the scroll position is restored
  - image-PDF pages split at 150 in, with a named `@page tail` for the short last page
- **Overlays** are hidden by an id-prefix list (`OVERLAY_SELECTOR`) plus `[data-gamut-overlay]` for
  future overlays, rather than retrofitting the attribute onto every inject. `<style>`
  elements are excluded, so `#__cathode_edit_css__` (live edits) keeps applying.
- **The "hide fixed & sticky" option was dropped.** The CDP capture draws them once anyway. The
  compatibility (DevTools-open) capture hides them automatically after the first screen.
- **JPG background** is always white; there's no page-colour option.
- **The filename** has no automatic `_full` / `_2x` suffix. `{area}` and `{scale}` are tokens instead.
  Default pattern: `{title}_{date}_{time}`.
- **The last folder** is kept per project in `localStorage` (`LS.exportDirs`), not the `.cathode`
  manifest. The default is `~/Pictures/Gamut`.
- **Save dialog before capture:** Export opens the native Save dialog while the export dialog is still
  up. Cancelling it keeps the dialog open. The capture runs only once there's a path.
- **Quick re-export:** Shift+click skips both dialogs: last settings, last folder, `-2`/`-3`
  suffix if the name exists.

- **Scroll-triggered content (fixed after testing):** pages that reveal sections as they scroll into
  view came out blank in the one-pass capture. On a test page, the one pass kept 4 of 12 sections.
  Reveal-and-hide sections were hidden again once the pre-scroll returned to the top, and
  script-driven fades hadn't finished in the 90 ms per step.
  - Full page now has a **Method** choice:
    - **As you scroll** (default): scroll one screen at a time, `settle()`, capture that
      screen, stitch. It got 12/12 sections, at ~0.5–0.7 s a screen.
    - **One pass**: the original fast capture.
  - `settle()` jumps finite CSS/Web animations to their end (`finish()`), then waits until
    the opacity/transform of what's in view stops changing (for GSAP/rAF animations), up to 1.5 s.
  - Fixed/sticky elements appear on the first screen only.
  - The dialog's preview runs a brief reveal pass first when As you scroll is chosen (~2.5 s
    for 13 screens). The "Load lazy content first" switch is gone; As you scroll covers it.
    One pass keeps the pre-scroll.

## Not built yet
Phase 3 (Element, Selection, scrolling-panel capture) and phase 4.
