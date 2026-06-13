// ── Shared inline SVG icons ───────────────────────────────────────
// Single source for icons that appear in more than one surface (main
// renderer, component-picker window, modals). Each export is a function so
// callers can pick a size without duplicating path data. All icons use
// currentColor and inherit the surrounding text color.
//
// Add icons HERE when the same glyph is needed in a second place — duplicated
// path data is how past icon swaps ended up touching three files.

function trashIcon(size = 15) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 4.75H15.25"/><path d="M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75"/><path d="M7.23 8.73L10.77 12.27"/><path d="M10.77 8.73L7.23 12.27"/><path d="M13.7 7.75L13.35 14.35C13.294 15.42 12.416 16.25 11.353 16.25H6.648C5.584 16.25 4.707 15.42 4.651 14.35L4.303 7.75"/></svg>`;
}

function eyeIcon(size = 14) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.75C10.5188 11.75 11.75 10.5188 11.75 9C11.75 7.48122 10.5188 6.25 9 6.25C7.48122 6.25 6.25 7.48122 6.25 9C6.25 10.5188 7.48122 11.75 9 11.75Z"/><path d="M15.9557 7.88669C16.3481 8.57939 16.3481 9.42049 15.9557 10.1132C15.0087 11.7849 12.7944 14.4999 9 14.4999C5.2056 14.4999 2.9912 11.7849 2.0443 10.1132C1.6519 9.42049 1.6519 8.57939 2.0443 7.88669C2.9913 6.21499 5.2056 3.5 9 3.5C12.7944 3.5 15.0088 6.21499 15.9557 7.88669Z"/></svg>`;
}

function chevronRightIcon(size = 12, strokeWidth = 1.5) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="M6.75 4.5L11.25 9L6.75 13.5"/></svg>`;
}

module.exports = { trashIcon, eyeIcon, chevronRightIcon };
