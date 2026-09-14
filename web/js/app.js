// Phase 6-A1: page shell wiring (symptom search/chips, collapsible sections,
// language toggle state, online/offline indicator).
// Phase 6-A3: ASSESS wired to real inference (below).
// Phase 6-A4: result rendering + full bilingual strings (below).
import { predict } from './infer.js';
import { renderResult } from './render.js';
import { STRINGS } from './strings.js';
import { openSheet } from './sheet.js';

let symptomsList = [];
const selectedSymptoms = new Set();
const uncertainSymptoms = new Set(); // F12 "Not sure" -- excluded from the feature vector only
let currentLang = 'en';
let severityMap = {};
let cooccurrence = {};
let symptomDescriptions = {};

async function loadSeverity() {
  const res = await fetch('./data/severity.json');
  severityMap = await res.json();
}

async function loadCooccurrence() {
  const res = await fetch('./data/cooccurrence.json');
  cooccurrence = await res.json();
}

async function loadSymptomDescriptions() {
  const res = await fetch('./data/symptom_descriptions.json');
  symptomDescriptions = await res.json();
}

let phcList = [];
async function loadPHC() {
  const res = await fetch('./data/phc_ghaziabad.json');
  phcList = await res.json();
}

let conditionInfo = {};
async function loadConditionInfo() {
  const res = await fetch('./data/condition_info.json');
  conditionInfo = await res.json();
}


const searchInput = document.getElementById('symptom-search');
const dropdown = document.getElementById('symptom-dropdown');
const chipsContainer = document.getElementById('selected-chips');
const ghostChipsContainer = document.getElementById('ghost-chips');

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
      const row = document.createElement('div');
      row.className = 'match-row';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'match-name';
      nameBtn.textContent = symptomId;
      nameBtn.addEventListener('click', () => addSymptom(symptomId));
      const notSureBtn = document.createElement('button');
      notSureBtn.type = 'button';
      notSureBtn.className = 'not-sure-btn';
      notSureBtn.textContent = STRINGS[currentLang].notSure;
      notSureBtn.addEventListener('click', () => addSymptom(symptomId, { uncertain: true }));
      row.appendChild(nameBtn);
      row.appendChild(notSureBtn);
      dropdown.appendChild(row);
    });
  }
  dropdown.hidden = false;
}

function addSymptom(symptomId, { uncertain = false } = {}) {
  selectedSymptoms.add(symptomId);
  if (uncertain) uncertainSymptoms.add(symptomId);
  searchInput.value = '';
  dropdown.hidden = true;
  renderChips();
}

function removeSymptom(symptomId) {
  selectedSymptoms.delete(symptomId);
  uncertainSymptoms.delete(symptomId);
  renderChips();
}

function showSymptomInfo(symptomId) {
  const d = symptomDescriptions[symptomId];
  const text = d ? d[currentLang] : '';
  openSheet(`<h3>${symptomId}</h3><p>${text}</p>`);
}

function renderChips() {
  chipsContainer.innerHTML = '';
  selectedSymptoms.forEach(symptomId => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (uncertainSymptoms.has(symptomId) ? ' uncertain' : '');
    const label = document.createElement('span');
    label.textContent = symptomId;
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'chip-info-btn';
    infoBtn.textContent = 'ℹ';
    infoBtn.setAttribute('aria-label', `About ${symptomId}`);
    infoBtn.addEventListener('click', () => showSymptomInfo(symptomId));
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${symptomId}`);
    removeBtn.addEventListener('click', () => removeSymptom(symptomId));
    chip.appendChild(label);
    chip.appendChild(infoBtn);
    chip.appendChild(removeBtn);
    chipsContainer.appendChild(chip);
  });
  renderGhostChips();
}

// F8: after 2+ symptoms, suggest up to 3 frequently co-occurring symptoms
// (precomputed per-symptom top-3 in cooccurrence.json, Phase 2 step 2.5).
function renderGhostChips() {
  ghostChipsContainer.innerHTML = '';
  if (selectedSymptoms.size < 2) return;

  const candidates = [];
  selectedSymptoms.forEach(symptomId => {
    (cooccurrence[symptomId] || []).forEach(candidate => {
      if (!selectedSymptoms.has(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    });
  });
  const top3 = candidates.slice(0, 3);
  if (top3.length === 0) return;

  const label = document.createElement('span');
  label.className = 'ghost-chips-label';
  label.textContent = STRINGS[currentLang].alsoCommon;
  ghostChipsContainer.appendChild(label);

  top3.forEach(symptomId => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost-chip';
    btn.textContent = symptomId;
    btn.addEventListener('click', () => addSymptom(symptomId));
    ghostChipsContainer.appendChild(btn);
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

// Applies STRINGS[lang] to every static label in the page shell.
function applyStrings(lang) {
  const t = STRINGS[lang];
  document.getElementById('symptom-search-label').textContent = t.whatAreYouFeeling;
  searchInput.placeholder = t.searchPlaceholder;
  document.getElementById('vitals-summary').textContent = t.vitalsLabel;
  document.getElementById('vital-temp-label').textContent = t.temperatureLabel;
  document.getElementById('vital-pulse-label').textContent = t.pulseLabel;
  document.getElementById('vital-breathing-label').textContent = t.breathingLabel;
  document.getElementById('risk-factors-summary').textContent = t.riskFactorsLabel;
  document.getElementById('age-label').textContent = t.ageLabel;
  document.getElementById('sex-label').textContent = t.sexLabel;
  document.getElementById('sex-option-m').textContent = t.male;
  document.getElementById('sex-option-f').textContent = t.female;
  document.getElementById('sex-option-o').textContent = t.other;
  document.getElementById('assess-btn').textContent = t.assess;
  document.getElementById('disclaimer-text').textContent = `⚠ ${t.disclaimer}`;
  document.getElementById('status-text').textContent =
    navigator.onLine ? t.online : t.offline;
  document.querySelectorAll('#risk-factor-toggles button[data-factor]').forEach(btn => {
    btn.textContent = t.riskFactorLabels[btn.dataset.factor];
  });
  document.getElementById('tab-assess-btn').textContent = t.tabAssess;
  document.getElementById('tab-history-btn').textContent = t.tabHistory;
  document.getElementById('history-notice').textContent = t.historyNotice;
  document.getElementById('clear-history-btn').textContent = t.clearHistory;
}

document.getElementById('lang-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-lang]');
  if (!btn) return;
  currentLang = btn.dataset.lang;
  document.querySelectorAll('#lang-toggle button').forEach(b => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  document.documentElement.lang = currentLang;
  applyStrings(currentLang);
  renderGhostChips();
  if (!document.getElementById('history-view').hidden) renderHistory();
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

// --- Voice input (F4) ---
const micBtn = document.getElementById('mic-btn');
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

// Exposed standalone so the matching logic can be verified directly
// (headless test environments have no real microphone/STT backend to
// drive an end-to-end recognition result through).
function matchTranscriptToSymptoms(transcript) {
  const words = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const matches = [];
  for (const symptomId of symptomsList) {
    const readable = symptomId.replace(/_/g, ' ').toLowerCase();
    if (words.includes(readable)) matches.push(symptomId);
  }
  return matches;
}
window.matchTranscriptToSymptoms = matchTranscriptToSymptoms;

if (SpeechRecognitionCtor) {
  micBtn.hidden = false;
  let listening = false;

  micBtn.addEventListener('click', () => {
    if (listening) return;
    const recognizer = new SpeechRecognitionCtor();
    recognizer.lang = currentLang === 'hi' ? 'hi-IN' : 'en-IN';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;

    listening = true;
    micBtn.textContent = '🔴';
    micBtn.setAttribute('aria-label', 'Listening...');

    recognizer.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const matches = matchTranscriptToSymptoms(transcript);
      matches.forEach(addSymptom);
      console.log(`Voice transcript: "${transcript}" -> matched symptoms:`, matches);
    };
    recognizer.onerror = (event) => {
      console.log('Speech recognition error:', event.error);
    };
    recognizer.onend = () => {
      listening = false;
      micBtn.textContent = '🎤';
      micBtn.setAttribute('aria-label', 'Voice input');
    };
    recognizer.start();
  });
} else {
  micBtn.hidden = true;
}

// --- ASHA worker mode (F19) ---
const ashaToggle = document.getElementById('asha-toggle');
let ashaMode = localStorage.getItem('ashaMode') === 'true';
function applyAshaMode() {
  document.body.classList.toggle('asha-mode', ashaMode);
  ashaToggle.setAttribute('aria-pressed', String(ashaMode));
}
applyAshaMode();
ashaToggle.addEventListener('click', () => {
  ashaMode = !ashaMode;
  localStorage.setItem('ashaMode', String(ashaMode));
  applyAshaMode();
});

// Online/offline indicator
const statusDot = document.getElementById('status-dot');
function updateOnlineStatus() {
  const online = navigator.onLine;
  statusDot.classList.toggle('offline', !online);
  statusDot.querySelector('.status-text').textContent =
    online ? STRINGS[currentLang].online : STRINGS[currentLang].offline;
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

loadSymptoms();
loadSeverity();
loadCooccurrence();
loadSymptomDescriptions();
loadPHC();
loadConditionInfo();
applyStrings(currentLang);
updateOnlineStatus();

function readVitals() {
  const temp = document.getElementById('vital-temp').value;
  const pulse = document.getElementById('vital-pulse').value;
  const breathing = document.getElementById('vital-breathing').value;
  return {
    temp_c: temp === '' ? null : parseFloat(temp),
    pulse_bpm: pulse === '' ? null : parseFloat(pulse),
    breathing_rpm: breathing === '' ? null : parseFloat(breathing),
  };
}

function resetForm() {
  selectedSymptoms.clear();
  uncertainSymptoms.clear();
  renderChips();
  searchInput.value = '';
  document.getElementById('vital-temp').value = '';
  document.getElementById('vital-pulse').value = '';
  document.getElementById('vital-breathing').value = '';
  document.querySelectorAll('#risk-factor-toggles button[data-factor]').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false');
    riskFactors[btn.dataset.factor] = false;
  });
}

// --- Assessment history (F14) ---
const HISTORY_KEY = 'arogya_history';
const MAX_HISTORY = 5;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistoryEntry(result, snapshot) {
  const history = loadHistory();
  history.unshift({
    timestamp: new Date().toISOString(),
    profile: null, // no family-profile system yet (F7, 6-C3) -- wired in then
    symptoms: snapshot.symptoms,
    vitals: snapshot.vitals,
    riskFactors: snapshot.riskFactors,
    ageYears: snapshot.ageYears,
    sex: snapshot.sex,
    tier: result.tier,
    topDisease: result.tierSource === 'model' ? result.topClass : null,
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function tierBadgeClass(tier) {
  if (tier === 'EMERGENCY') return 'emergency';
  if (tier === 'URGENT') return 'urgent';
  return 'routine';
}

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  const history = loadHistory();
  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = STRINGS[currentLang].historyEmpty;
    list.appendChild(empty);
    return;
  }
  history.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'history-entry';
    row.addEventListener('click', () => reopenHistoryEntry(entry));

    const top = document.createElement('div');
    top.className = 'history-entry-top';
    const date = document.createElement('span');
    date.className = 'history-date';
    date.textContent = new Date(entry.timestamp).toLocaleString(currentLang === 'hi' ? 'hi-IN' : 'en-IN');
    const badge = document.createElement('span');
    badge.className = `history-tier-badge ${tierBadgeClass(entry.tier)}`;
    badge.textContent = entry.tier;
    top.appendChild(date);
    top.appendChild(badge);
    row.appendChild(top);

    if (entry.topDisease) {
      const disease = document.createElement('div');
      disease.className = 'history-top-disease';
      disease.textContent = entry.topDisease;
      row.appendChild(disease);
    }

    const symptoms = document.createElement('div');
    symptoms.className = 'history-symptoms';
    symptoms.textContent = entry.symptoms.join(', ');
    row.appendChild(symptoms);

    list.appendChild(row);
  });
}

function reopenHistoryEntry(entry) {
  resetForm();
  entry.symptoms.forEach(s => selectedSymptoms.add(s));
  renderChips();
  document.getElementById('age-input').value = entry.ageYears;
  document.getElementById('sex-select').value = entry.sex;
  if (entry.vitals.temp_c != null) document.getElementById('vital-temp').value = entry.vitals.temp_c;
  if (entry.vitals.pulse_bpm != null) document.getElementById('vital-pulse').value = entry.vitals.pulse_bpm;
  if (entry.vitals.breathing_rpm != null) document.getElementById('vital-breathing').value = entry.vitals.breathing_rpm;
  Object.entries(entry.riskFactors || {}).forEach(([factor, on]) => {
    if (!on) return;
    riskFactors[factor] = true;
    const btn = document.querySelector(`#risk-factor-toggles button[data-factor="${factor}"]`);
    if (btn) btn.setAttribute('aria-pressed', 'true');
  });
  switchTab('assess');
}

document.getElementById('clear-history-btn').addEventListener('click', () => {
  if (confirm(STRINGS[currentLang].confirmClearHistory)) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
});

function switchTab(tab) {
  const main = document.querySelector('main');
  const historyView = document.getElementById('history-view');
  const isHistory = tab === 'history';
  main.hidden = isHistory;
  historyView.hidden = !isHistory;
  document.getElementById('tab-assess-btn').setAttribute('aria-pressed', String(!isHistory));
  document.getElementById('tab-history-btn').setAttribute('aria-pressed', String(isHistory));
  if (isHistory) renderHistory();
}

document.getElementById('tab-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

document.getElementById('assess-btn').addEventListener('click', async () => {
  const ageYears = parseFloat(document.getElementById('age-input').value);
  const sex = document.getElementById('sex-select').value;
  const vitals = readVitals();

  const result = await predict(Array.from(selectedSymptoms), ageYears, sex, riskFactors, vitals, uncertainSymptoms);

  // Apply severity map when the model (not a red flag) produced the result --
  // tier = max(red_flag_tier, severity_tier), and red-flag results already
  // returned their own tier directly from predict().
  if (result.tierSource === 'model') {
    result.tier = severityMap[result.topClass] || 'ROUTINE';
  }

  console.log('ASSESS result:', result);
  const formSnapshot = {
    symptoms: Array.from(selectedSymptoms),
    vitals,
    riskFactors: { ...riskFactors },
    ageYears,
    sex,
  };
  saveHistoryEntry(result, formSnapshot);
  renderResult(result, currentLang, resetForm, phcList, formSnapshot, ashaMode, conditionInfo);
});
