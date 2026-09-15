// Phase 6-A1: page shell wiring (symptom search/chips, collapsible sections,
// language toggle state, online/offline indicator).
// Phase 6-A3: ASSESS wired to real inference (below).
// Phase 6-A4: result rendering + full bilingual strings (below).
import { predict } from './infer.js';
import { renderResult } from './render.js';
import { STRINGS } from './strings.js';
import { openSheet } from './sheet.js';
import {
  getActiveProfile, renderProfileHeader, renderProfilesScreen,
  saveAssessmentFromResult, showToast, initProfileSystem,
} from './profiles.js';

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

let followups = {};
async function loadFollowups() {
  const res = await fetch('./data/followups.json');
  followups = await res.json();
}

let redFlagRules = [];
async function loadRedFlagRules() {
  const res = await fetch('./data/red_flags.json');
  redFlagRules = await res.json();
}

// F11: plain-language rendering of a rule's structured conditions.
function describeRule(rule, lang) {
  const t = STRINGS[lang];
  const parts = [];
  if (rule.all_of && rule.all_of.length) parts.push(rule.all_of.join(` ${t.ruleAnd} `));
  if (rule.any_of && rule.any_of.length) parts.push(`(${rule.any_of.join(` ${t.ruleOr} `)})`);
  if (rule.age_max_months != null) parts.push(t.ageUnder(rule.age_max_months));
  if (rule.age_min_years != null) parts.push(t.ageOver(rule.age_min_years));
  if (rule.risk_factor_required) parts.push(t.riskFactorRequired(rule.risk_factor_required));
  if (rule.vital_temp_above != null) parts.push(t.tempAbove(rule.vital_temp_above));
  if (rule.vital_pulse_above != null) parts.push(t.pulseAbove(rule.vital_pulse_above));
  return parts.join(` ${t.ruleAnd} `);
}

function openRuleSetViewer() {
  const t = STRINGS[currentLang];
  let html = `<h3>${t.notClinicallyReviewedHeader}</h3>`;
  redFlagRules.forEach(rule => {
    const rationale = currentLang === 'hi' ? rule.rationale_hi : rule.rationale_en;
    html += `<div class="rule-card">
      <div class="rule-id">${rule.id}</div>
      <div class="rule-conditions"><strong>${t.ruleConditionsLabel}:</strong> ${describeRule(rule, currentLang)}</div>
      <div class="rule-rationale">${rationale}</div>
    </div>`;
  });
  openSheet(html);
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
  document.getElementById('tab-history-btn').textContent = t.profiles;
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
  renderProfileHeader();
  if (!document.getElementById('history-view').hidden) renderProfilesScreen();
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


// --- Medicine reminders (F15) -- never names a drug (S1); the system has
// no medication data to name in the first place, so this is structural,
// not just a copy choice. ---
const REMINDER_KEY = 'arogya_reminder';
// A constant gap works for all of these since they divide 24h evenly
// (24/1, 24/2, 24/3) -- repeatedly adding it lands back on the original
// chosen time every 24h regardless of repeat frequency.
const REPEAT_GAP_HOURS = { daily: 24, twice: 12, thrice: 8 };
let reminderTimers = [];

function fireReminderNotification() {
  const body = 'Take your medicine.'; // S1: never names a drug -- fixed, generic text only
  console.log('REMINDER_FIRED:', body);
  if (Notification.permission === 'granted') {
    new Notification('ArogyaAI', { body });
  }
}

function nextOccurrence(hh, mm, fromDate) {
  const next = new Date(fromDate);
  next.setHours(hh, mm, 0, 0);
  if (next <= fromDate) next.setDate(next.getDate() + 1);
  return next;
}
// Exposed for direct testing, same reasoning as matchTranscriptToSymptoms:
// waiting a real setTimeout out is testing the JS runtime, not this logic.
window.__fireReminderNotification = fireReminderNotification;
window.__nextOccurrence = nextOccurrence;

function clearScheduledReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
}

// setTimeout, chained -- not setInterval -- so each next fire time is
// recomputed against the wall clock (handles repeat's uneven within-day
// gaps in REPEAT_INTERVALS_HOURS, and doesn't drift like nested intervals).
function scheduleFromNow(time, repeat) {
  clearScheduledReminders();
  const [hh, mm] = time.split(':').map(Number);
  let fireAt = nextOccurrence(hh, mm, new Date());
  const gapHours = REPEAT_GAP_HOURS[repeat]; // undefined for 'once'

  function scheduleNext() {
    const delay = fireAt.getTime() - Date.now();
    const timer = setTimeout(() => {
      fireReminderNotification();
      if (!gapHours) return;
      fireAt = new Date(fireAt.getTime() + gapHours * 3600 * 1000);
      scheduleNext();
    }, Math.max(0, delay));
    reminderTimers.push(timer);
  }
  scheduleNext();
}

function setReminder(time, repeat) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify({ time, repeat }));
  if (Notification.permission === 'granted') {
    scheduleFromNow(time, repeat);
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') scheduleFromNow(time, repeat);
    });
  }
}

// Re-schedule on load if a reminder was already set in a previous session.
if ('Notification' in window) {
  try {
    const stored = JSON.parse(localStorage.getItem(REMINDER_KEY));
    if (stored && Notification.permission === 'granted') {
      scheduleFromNow(stored.time, stored.repeat);
    }
  } catch {
    // ignore malformed/missing stored reminder
  }
}

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
loadFollowups();
loadRedFlagRules();
applyStrings(currentLang);
updateOnlineStatus();
initProfileSystem((tab) => switchTab('history'));

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

// F16 (symptom trend tracker) predates this profile-system rewrite and
// isn't part of the new spec, but nothing asked for it to be removed --
// re-pointed at the new per-profile assessments array instead of the old
// flat arogya_history. Same rule: 3+ of the active profile's last 5.
function computeTrendNotices() {
  const profile = getActiveProfile();
  if (!profile) return [];
  const recent = profile.assessments.slice(0, 5);
  if (recent.length < 3) return [];
  const counts = {};
  recent.forEach(entry => {
    entry.symptoms.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  });
  return Object.entries(counts)
    .filter(([, n]) => n >= 3)
    .map(([symptom, n]) => ({ symptom, count: n, total: recent.length }));
}

function switchTab(tab) {
  const main = document.querySelector('main');
  const historyView = document.getElementById('history-view');
  const isHistory = tab === 'history';
  main.hidden = isHistory;
  historyView.hidden = !isHistory;
  document.getElementById('tab-assess-btn').setAttribute('aria-pressed', String(!isHistory));
  document.getElementById('tab-history-btn').setAttribute('aria-pressed', String(isHistory));
  if (isHistory) renderProfilesScreen();
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
  await saveAssessmentFromResult(result, formSnapshot, showToast);
  const trendNotices = computeTrendNotices();
  const activeProfile = getActiveProfile();
  renderResult(result, currentLang, resetForm, phcList, formSnapshot, conditionInfo, followups, activeProfile ? activeProfile.name : null, setReminder, trendNotices, openRuleSetViewer);
});
