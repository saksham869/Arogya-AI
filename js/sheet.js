// Generic bottom sheet, shared by app.js (F12 symptom info) and render.js
// (F20 condition info) so both reuse one overlay instead of duplicating it.
const overlay = document.getElementById('sheet-overlay');
const body = document.getElementById('sheet-body');

export function openSheet(html) {
  body.innerHTML = html;
  overlay.hidden = false;
}

export function closeSheet() {
  overlay.hidden = true;
}

document.getElementById('sheet-close').addEventListener('click', closeSheet);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeSheet();
});
