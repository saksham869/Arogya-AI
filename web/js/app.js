// Phase 6-A1: page shell wiring (symptom search/chips, collapsible sections,
// language toggle state, online/offline indicator). The ASSESS button is
// wired to real inference in 6-A3.

let symptomsList = [];
const selectedSymptoms = new Set();
let currentLang = 'en';

const searchInput = document.getElementById('symptom-search');
const dropdown = document.getElementById('symptom-dropdown');
const chipsContainer = document.getElementById('selected-chips');

async function loadSymptoms() {
  const res = await fetch('./data/symptoms.json');
  symptomsList = await res.json();
}

function renderDropdown(matches) {
  dropdown.innerHTML = '';
  if (matches.length === 0) {
    const div = document.createElement('div');
    div.className = 'no-match';
    div.style.padding = '10px 12px';
    div.textContent = 'No matching symptoms';
    dropdown.appendChild(div);
  } else {
    matches.slice(0, 8).forEach(symptomId => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = symptomId;
      btn.addEventListener('click', () => addSymptom(symptomId));
      dropdown.appendChild(btn);
    });
  }
  dropdown.hidden = false;
}

function addSymptom(symptomId) {
  selectedSymptoms.add(symptomId);
  searchInput.value = '';
  dropdown.hidden = true;
  renderChips();
}

function removeSymptom(symptomId) {
  selectedSymptoms.delete(symptomId);
  renderChips();
}

function renderChips() {
  chipsContainer.innerHTML = '';
  selectedSymptoms.forEach(symptomId => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = symptomId;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${symptomId}`);
    removeBtn.addEventListener('click', () => removeSymptom(symptomId));
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    chipsContainer.appendChild(chip);
  });
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    dropdown.hidden = true;
    return;
  }
  const matches = symptomsList.filter(
    s => !selectedSymptoms.has(s) && s.toLowerCase().includes(q)
  );
  renderDropdown(matches);
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) dropdown.hidden = false;
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-row')) dropdown.hidden = true;
});

// Language toggle (visual state now; full bilingual strings land in 6-A4)
document.getElementById('lang-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-lang]');
  if (!btn) return;
  currentLang = btn.dataset.lang;
  document.querySelectorAll('#lang-toggle button').forEach(b => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  document.documentElement.lang = currentLang;
});

// Risk factor toggle chips
const riskFactors = {};
document.getElementById('risk-factor-toggles').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-factor]');
  if (!btn) return;
  const factor = btn.dataset.factor;
  const isOn = btn.getAttribute('aria-pressed') === 'true';
  btn.setAttribute('aria-pressed', String(!isOn));
  riskFactors[factor] = !isOn;
});

// Online/offline indicator
const statusDot = document.getElementById('status-dot');
function updateOnlineStatus() {
  const online = navigator.onLine;
  statusDot.classList.toggle('offline', !online);
  statusDot.querySelector('.status-text').textContent = online ? 'Online' : 'Offline';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

loadSymptoms();
updateOnlineStatus();

// ASSESS button: stub until 6-A3 wires in real inference.
document.getElementById('assess-btn').addEventListener('click', () => {
  console.log('ASSESS clicked. Selected symptoms:', Array.from(selectedSymptoms));
});
