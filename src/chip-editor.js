// Chip editors: text inputs that can hold chips (attached files, Box/Lasso selections) in
// the middle of the sentence, so you can type around them. They are contenteditable
// elements, but install() gives each one the slice of the textarea API the app actually
// uses — value, selectionStart/End and placeholder — so code written against a textarea
// keeps working unchanged.
//
// A chip is any `.composer-chip` inside the editor. It reads into `value` as its
// `data-text` (a file chip's path), or as whatever the editor's `chipText` hook returns
// (the Box/Lasso editor numbers its selections that way).

const chipTextOf = (el, chip) => {
  const custom = el && el._chipText ? el._chipText(chip) : null;
  return custom != null ? custom : (chip.dataset.text || '');
};

// Flatten the editor (or a fragment cloned out of it) to the text it stands for.
function serialize(root, el) {
  let out = '';
  const walk = (node) => node.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.data;
    else if (n.nodeType === 1) {
      if (n.classList.contains('composer-chip')) out += chipTextOf(el, n);
      else if (n.tagName === 'BR') out += '\n';
      else { if (/^(DIV|P)$/.test(n.tagName) && out && !out.endsWith('\n')) out += '\n'; walk(n); }
    }
  });
  walk(root);
  return out.replace(/ /g, ' ');
}

function valueOf(el) {
  const out = serialize(el, el);
  // Chromium parks a <br> at the end of an editor whose last line is empty; it isn't text.
  let last = el.lastChild;
  while (last && last.nodeType === 3 && !last.data) last = last.previousSibling;
  return last && last.nodeName === 'BR' ? out.replace(/\n$/, '') : out;
}

const hasChips = (el) => !!el.querySelector('.composer-chip');
function syncEmpty(el) { el.classList.toggle('is-empty', !hasChips(el) && !valueOf(el).trim()); }

// Where a DOM point falls in `value`.
function offsetAt(el, node, off) {
  const r = document.createRange();
  r.selectNodeContents(el);
  try { r.setEnd(node, off); } catch (_) { return valueOf(el).length; }
  const box = document.createElement('div');
  box.appendChild(r.cloneContents());
  return serialize(box, el).length;
}

// The caret's range: the live one while it sits in the editor, else where it last was.
function caretRange(el) {
  const s = document.getSelection();
  if (s && s.rangeCount && el.contains(s.anchorNode)) return s.getRangeAt(0);
  return el._savedRange && el.contains(el._savedRange.startContainer) ? el._savedRange : null;
}

// Put the caret at a `value` offset. Landing on a chip or line break puts it just after.
function setCaret(el, pos) {
  const r = document.createRange();
  let left = Math.max(0, pos), placed = false;
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (placed) return;
      if (n.nodeType === 3) {
        if (left <= n.data.length) { r.setStart(n, left); placed = true; return; }
        left -= n.data.length;
      } else if (n.nodeType === 1) {
        const len = n.classList.contains('composer-chip') ? chipTextOf(el, n).length : n.tagName === 'BR' ? 1 : -1;
        if (len < 0) { walk(n); continue; }
        left -= len;
        if (left <= 0) { r.setStartAfter(n); placed = true; return; }
      }
    }
  };
  walk(el);
  if (!placed) { r.selectNodeContents(el); r.collapse(false); }
  r.collapse(true);
  el._savedRange = r.cloneRange();
  if (document.activeElement === el) { const s = document.getSelection(); s.removeAllRanges(); s.addRange(r); }
}

function install(el) {
  if (!el || el._chipEditor) return el;
  el._chipEditor = true;
  el._savedRange = null;
  document.addEventListener('selectionchange', () => {
    const s = document.getSelection();
    if (s && s.rangeCount && el.contains(s.anchorNode)) el._savedRange = s.getRangeAt(0).cloneRange();
  });
  Object.defineProperties(el, {
    value: {
      configurable: true,
      get() { return valueOf(el); },
      set(v) { el.textContent = v == null ? '' : String(v); el._savedRange = null; syncEmpty(el); },
    },
    selectionStart: {
      configurable: true,
      get() { const r = caretRange(el); return r ? offsetAt(el, r.startContainer, r.startOffset) : valueOf(el).length; },
      set(v) { setCaret(el, v); },
    },
    selectionEnd: {
      configurable: true,
      get() { const r = caretRange(el); return r ? offsetAt(el, r.endContainer, r.endOffset) : valueOf(el).length; },
      set(v) { setCaret(el, v); },
    },
    placeholder: {
      configurable: true,
      get() { return el.dataset.placeholder || ''; },
      set(v) { el.dataset.placeholder = v; },
    },
  });
  el.addEventListener('input', () => syncEmpty(el));
  // focus() from code lands a contenteditable's caret at the start; a textarea keeps its
  // place. Put it back where it was, or at the end. A click places its own caret.
  let pointerDown = false;
  el.addEventListener('mousedown', () => { pointerDown = true; setTimeout(() => { pointerDown = false; }, 0); });
  el.addEventListener('focus', () => {
    if (pointerDown) return;
    const r = el._savedRange && el.contains(el._savedRange.startContainer) ? el._savedRange.cloneRange() : null;
    const s = document.getSelection();
    if (r) { s.removeAllRanges(); s.addRange(r); } else setCaret(el, valueOf(el).length);
  });
  syncEmpty(el);
  return el;
}

// Drop a chip into the text — at `point` ({x, y}, e.g. where a file was dropped) when it
// lands in the editor, else at the caret, else at the end — with a space after it to carry
// on typing into. Fires `input` so the editor's listeners see the change.
function insertChip(el, chip, point) {
  let range = null;
  if (point && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(point.x, point.y);
    if (r && el.contains(r.startContainer)) range = r;
  }
  if (!range) range = caretRange(el);
  const space = document.createTextNode(' ');
  if (range) {
    range.deleteContents();
    // Dropped straight after a word: keep the chip from gluing onto it.
    const prev = valueOf(el).slice(0, offsetAt(el, range.startContainer, range.startOffset)).slice(-1);
    range.insertNode(space); range.insertNode(chip);
    if (prev && !/\s/.test(prev)) chip.before(' ');
  }
  else {
    if (el.lastChild && el.lastChild.nodeName === 'BR') el.lastChild.remove();
    if (/\S$/.test(valueOf(el))) el.append(' ');
    el.append(chip, space);
  }
  const after = document.createRange();
  after.setStart(space, 1); after.collapse(true);
  el.focus();
  const s = document.getSelection(); s.removeAllRanges(); s.addRange(after);
  el._savedRange = after.cloneRange();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return chip;
}

// Take a chip out and tell the editor, as if it had been backspaced over.
function removeChip(chip) {
  const el = chip.closest('[contenteditable]:not([contenteditable="false"])');
  chip.remove();
  if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
}

const chips = (el) => [...el.querySelectorAll('.composer-chip')];

module.exports = { install, insertChip, removeChip, chips, serialize: valueOf };
