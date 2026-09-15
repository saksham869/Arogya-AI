// Full patient profile system (v2). Replaces the earlier F7 (family
// profiles) + F14 (assessment history) implementation entirely -- the old
// 'arogya_profiles' / 'arogya_active_profile' / 'arogya_history' keys are
// abandoned, not migrated, per the spec ("v2 so it doesn't conflict").
//
// Scope notes (disclosed, not silent):
//  - New profile screens are English-only. The rest of the app is fully
//    bilingual via strings.js; extending that to ~15 new strings here
//    wasn't asked for and would meaningfully grow this change further.
//  - Internal field name stays `sex` (not `gender`) anywhere it touches the
//    API contract, the trained model's feature encoding, or the red-flag
//    engine signature -- all load-bearing, tested infrastructure. Only
//    user-visible copy says "Gender".
//  - Card delete is a visible button, not swipe-to-reveal -- gesture
//    tracking is a lot of extra surface for one destructive action that
//    already has a confirm() dialog.

import { openSheet } from './sheet.js';

const PROFILES_KEY = 'arogya_profiles_v2';
const ACTIVE_KEY = 'arogya_active_profile_v2';
const MAX_ASSESSMENTS = 50;

// --- Data layer ---

export function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

export function getActiveProfile() {
  const id = getActiveProfileId();
  return id ? loadProfiles().find(p => p.id === id) || null : null;
}

export function setActiveProfileId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
  renderProfileHeader();
}

function newProfile({ name, age, gender }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    age,
    gender,
    riskFactors: {
      diabetes: false, hypertension: false, heartDisease: false,
      pregnancy: false, smoking: false, age60plus: false,
    },
    createdAt: now,
    updatedAt: now,
    schemaVersion: 2,
    assessments: [],
  };
}

function saveProfile(profile) {
  const profiles = loadProfiles();
  const i = profiles.findIndex(p => p.id === profile.id);
  profile.updatedAt = new Date().toISOString();
  if (i >= 0) profiles[i] = profile;
  else profiles.push(profile);
  saveProfiles(profiles);
}

function deleteProfileById(id) {
  saveProfiles(loadProfiles().filter(p => p.id !== id));
  if (getActiveProfileId() === id) setActiveProfileId(null);
}

// Exact cap logic from the spec, kept as its own function so 6-C-style
// direct testing doesn't need to click through 50 real assessments.
export function addAssessmentToProfile(profileId, assessment) {
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return null;
  if (profile.assessments.length >= MAX_ASSESSMENTS) {
    profile.assessments = profile.assessments.slice(0, MAX_ASSESSMENTS - 1);
  }
  profile.assessments.unshift(assessment);
  profile.updatedAt = new Date().toISOString();
  saveProfiles(profiles);
  return assessment;
}

function updateAssessmentLabel(profileId, assessmentId, label) {
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;
  const a = profile.assessments.find(x => x.id === assessmentId);
  if (!a || !a.location) return;
  a.location.label = label;
  saveProfiles(profiles);
  // If the detail sheet for this exact assessment is open, refresh it live.
  if (currentDetailAssessmentId === assessmentId) {
    openAssessmentDetail(profileId, assessmentId);
  }
}

function stats(profile) {
  const total = profile.assessments.length;
  const now = new Date();
  const thisMonth = profile.assessments.filter(a => {
    const d = new Date(a.timestamp);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const lastTier = total > 0 ? profile.assessments[0].tier : null;
  return { total, thisMonth, lastTier };
}

// --- Geolocation (opportunistic only, never prompts) + reverse geocoding ---

async function getLocationIfAlreadyGranted() {
  if (!navigator.geolocation || !navigator.permissions) return null;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state !== 'granted') return null;
  } catch {
    return null; // Permissions API unsupported for this query in this browser
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: null }),
      () => resolve(null),
      { timeout: 3000 }
    );
  });
}

const idle = window.requestIdleCallback ||
  ((cb) => setTimeout(() => cb({ timeRemaining: () => 50 }), 1));

// Nominatim's usage policy asks non-browser clients to send a descriptive
// User-Agent. Browsers make that impossible to honor literally: `fetch()`
// treats User-Agent as a forbidden header (Fetch spec) and silently sends
// the browser's real UA no matter what's set here -- this isn't something
// app code can work around. The policy's own browser-app path is the
// Referer header instead, which the browser sends automatically and which
// this request already carries (the page's own URL).
async function reverseGeocode(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
    { headers: { 'User-Agent': 'ArogyaAI/1.0 (academic prototype; see Referer)' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.address?.suburb || data.address?.city_district || data.address?.city
    || data.address?.town || data.address?.county || data.display_name || null;
}

// --- Assess-page integration ---

export function applyActiveProfileToAssessForm() {
  const chipContainer = document.getElementById('assessing-for-container');
  if (!chipContainer) return;
  const p = getActiveProfile();
  chipContainer.innerHTML = '';
  if (!p) return;
  document.getElementById('age-input').value = p.age;
  document.getElementById('sex-select').value = genderToSexCode(p.gender);
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'assessing-for-chip';
  chip.textContent = `Assessing for: ${p.name}`;
  chip.addEventListener('click', () => { renderProfilesScreen(); switchToProfilesTab(); });
  chipContainer.appendChild(chip);
}

function genderToSexCode(gender) {
  if (gender === 'Male') return 'M';
  if (gender === 'Female') return 'F';
  return 'O';
}
function sexCodeToGender(code) {
  if (code === 'M') return 'Male';
  if (code === 'F') return 'Female';
  return 'Other';
}

let switchToProfilesTab = () => {}; // wired by app.js via initProfileSystem()

// Called from app.js's ASSESS handler after a result renders.
export async function saveAssessmentFromResult(result, snapshot, showToast) {
  const profile = getActiveProfile();
  if (!profile) {
    showToast('Create a profile to save results', 'Create', () => {
      renderProfilesScreen();
      switchToProfilesTab();
    });
    return;
  }

  const assessment = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    symptoms: snapshot.symptoms,
    gender: sexCodeToGender(snapshot.sex),
    age: snapshot.ageYears,
    vitals: snapshot.vitals,
    riskFactors: snapshot.riskFactors,
    tier: result.tier,
    tierSource: result.tierSource,
    ruleId: result.ruleId,
    topDisease: result.tierSource === 'model' ? result.topClass : null,
    differential: result.differential.map(d => ({ disease: d.disease, probability: d.probability })),
    explanation: result.tierSource === 'red_flag' ? result.rationale : explanationText(result),
    location: null,
  };

  const location = await getLocationIfAlreadyGranted();
  if (location) assessment.location = location;

  addAssessmentToProfile(profile.id, assessment);

  if (location) {
    idle(() => {
      reverseGeocode(location.lat, location.lng)
        .then(label => { if (label) updateAssessmentLabel(profile.id, assessment.id, label); })
        .catch(() => {}); // best-effort only; assessment is already saved without it
    });
  }
}

function explanationText(result) {
  const names = (result.explanation || [])
    .filter(e => e.present !== false && !e.symptomId?.startsWith?.('age_band_'))
    .map(e => e.symptomId || e.symptom);
  if (names.length === 0) return '';
  return `Because you reported ${names.join(' and ')}`;
}

// --- Header switcher (avatar pill + dropdown) ---

export function renderProfileHeader() {
  const btn = document.getElementById('profile-avatar-btn');
  const dropdown = document.getElementById('profile-dropdown');
  const profile = getActiveProfile();
  const profiles = loadProfiles();

  if (profile) {
    btn.className = 'profile-avatar-btn has-profile';
    btn.innerHTML = `${initials(profile.name)} <span style="font-size:9px">▾</span>`;
  } else {
    btn.className = 'profile-avatar-btn no-profile';
    btn.textContent = '👤';
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    if (profiles.length === 0) {
      renderProfilesScreen();
      switchToProfilesTab();
      return;
    }
    dropdown.hidden = !dropdown.hidden;
    if (!dropdown.hidden) renderDropdown();
  };

  applyActiveProfileToAssessForm();
}

// Registered once from initProfileSystem() rather than inside
// renderProfileHeader() (which reruns on every lang toggle / profile
// switch) so it doesn't accumulate a duplicate listener each time.
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown && !dropdown.hidden && !e.target.closest('.profile-switcher')) dropdown.hidden = true;
});

function renderDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  const profiles = loadProfiles();
  const activeId = getActiveProfileId();
  dropdown.innerHTML = '';
  profiles.forEach(p => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'profile-dropdown-row';
    row.innerHTML = `<span>${p.name}</span>${p.id === activeId ? '<span class="profile-dropdown-check">✓</span>' : ''}`;
    row.addEventListener('click', () => {
      setActiveProfileId(p.id);
      dropdown.hidden = true;
      renderProfileHeader();
      if (!document.getElementById('history-view').hidden) renderProfilesScreen();
    });
    dropdown.appendChild(row);
  });
  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'profile-dropdown-row manage';
  manage.textContent = 'Manage profiles';
  manage.addEventListener('click', () => {
    dropdown.hidden = true;
    renderProfilesScreen();
    switchToProfilesTab();
  });
  dropdown.appendChild(manage);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// --- Screen 1: profile list ---

export function renderProfilesScreen() {
  const root = document.getElementById('profiles-content');
  const profiles = loadProfiles();
  const activeId = getActiveProfileId();

  if (profiles.length === 0) {
    root.innerHTML = `
      <div class="profile-empty-state">
        <div class="profile-empty-icon">👤</div>
        <p class="profile-empty-heading">Your profiles</p>
        <p class="profile-empty-sub">Create a profile to save your history</p>
        <button type="button" class="profile-form-save-btn" id="create-profile-btn">Create profile</button>
      </div>`;
    root.querySelector('#create-profile-btn').addEventListener('click', () => renderProfileForm());
    return;
  }

  root.innerHTML = `
    <div class="profile-list-heading-row">
      <h2>Your profiles</h2>
      <button type="button" class="profile-new-btn" id="new-profile-btn">+ New</button>
    </div>
    <div class="profile-card-list" id="profile-card-list"></div>`;
  root.querySelector('#new-profile-btn').addEventListener('click', () => renderProfileForm());

  const list = root.querySelector('#profile-card-list');
  profiles.forEach(p => {
    const card = document.createElement('div');
    card.className = 'profile-card' + (p.id === activeId ? ' active' : '');
    const lastAssessed = p.assessments.length > 0 ? relativeDate(p.assessments[0].timestamp) : 'No checks yet';
    card.innerHTML = `
      <div class="profile-card-avatar">${initials(p.name)}</div>
      <div class="profile-card-info">
        <div class="profile-card-name">${p.name}</div>
        <div class="profile-card-meta">${p.age} · ${p.gender}</div>
        <div class="profile-card-last">${lastAssessed}</div>
      </div>
      <button type="button" class="profile-card-delete-btn" data-delete="${p.id}">Delete</button>
      <span class="profile-card-chevron">›</span>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete]')) return;
      setActiveProfileId(p.id);
      renderProfileDetail(p.id);
    });
    card.querySelector('[data-delete]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete ${p.name}'s profile? This removes their saved history too.`)) {
        deleteProfileById(p.id);
        renderProfilesScreen();
      }
    });
    list.appendChild(card);
  });
}

function relativeDate(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Last assessed today';
  if (days === 1) return 'Last assessed 1 day ago';
  return `Last assessed ${days} days ago`;
}

// --- Screen 2: create / edit profile ---

function renderProfileForm(existingId = null) {
  const root = document.getElementById('profiles-content');
  const profiles = loadProfiles();
  const existing = existingId ? profiles.find(p => p.id === existingId) : null;

  root.innerHTML = `
    <div class="profile-form-header">
      <button type="button" class="profile-back-btn" id="form-back-btn">←</button>
      <h2>${existing ? 'Edit profile' : 'New profile'}</h2>
    </div>
    <div class="profile-form-field">
      <label for="pf-name">Name</label>
      <input type="text" id="pf-name" value="${existing ? existing.name : ''}">
    </div>
    <div class="profile-form-field">
      <label for="pf-age">Age</label>
      <input type="number" id="pf-age" min="0" max="120" step="0.1" value="${existing ? existing.age : ''}">
    </div>
    <div class="profile-form-field">
      <label>Gender</label>
      <div class="segmented-control" id="pf-gender">
        <button type="button" data-gender="Male" aria-pressed="${existing?.gender === 'Male' || !existing}">Male</button>
        <button type="button" data-gender="Female" aria-pressed="${existing?.gender === 'Female'}">Female</button>
        <button type="button" data-gender="Other" aria-pressed="${existing?.gender === 'Other'}">Other</button>
      </div>
    </div>
    <div class="profile-form-field">
      <label>Risk factors</label>
      <div class="toggle-row-list" id="pf-risk-factors">
        ${riskFactorRow('diabetes', 'Diabetes', existing)}
        ${riskFactorRow('hypertension', 'Hypertension', existing)}
        ${riskFactorRow('heartDisease', 'Heart disease', existing)}
        ${riskFactorRow('pregnancy', 'Pregnancy', existing)}
        ${riskFactorRow('smoking', 'Smoking', existing)}
        ${riskFactorRow('age60plus', 'Age 60+', existing)}
      </div>
    </div>
    <button type="button" class="profile-form-save-btn" id="pf-save-btn">${existing ? 'Update profile' : 'Save profile'}</button>`;

  root.querySelector('#form-back-btn').addEventListener('click', () => renderProfilesScreen());
  root.querySelectorAll('#pf-gender button').forEach(b => {
    b.addEventListener('click', () => {
      root.querySelectorAll('#pf-gender button').forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
    });
  });
  root.querySelectorAll('.toggle-switch').forEach(sw => {
    sw.addEventListener('click', () => {
      sw.setAttribute('aria-pressed', String(sw.getAttribute('aria-pressed') !== 'true'));
    });
  });

  root.querySelector('#pf-save-btn').addEventListener('click', () => {
    const name = root.querySelector('#pf-name').value.trim();
    const age = parseFloat(root.querySelector('#pf-age').value);
    if (!name || isNaN(age)) return;
    const gender = root.querySelector('#pf-gender button[aria-pressed="true"]').dataset.gender;
    const riskFactors = {};
    root.querySelectorAll('.toggle-switch').forEach(sw => {
      riskFactors[sw.dataset.factor] = sw.getAttribute('aria-pressed') === 'true';
    });

    const profile = existing || newProfile({ name, age, gender });
    profile.name = name;
    profile.age = age;
    profile.gender = gender;
    profile.riskFactors = riskFactors;
    saveProfile(profile);
    setActiveProfileId(profile.id);
    renderProfileDetail(profile.id);
  });
}

function riskFactorRow(key, label, existing) {
  const on = existing ? !!existing.riskFactors[key] : false;
  return `<div class="toggle-row">
    <span>${label}</span>
    <button type="button" class="toggle-switch" data-factor="${key}" aria-pressed="${on}"></button>
  </div>`;
}

// --- Screen 3: profile detail ---

function renderProfileDetail(profileId) {
  const root = document.getElementById('profiles-content');
  const profile = loadProfiles().find(p => p.id === profileId);
  if (!profile) { renderProfilesScreen(); return; }
  const s = stats(profile);

  root.innerHTML = `
    <div class="profile-form-header">
      <button type="button" class="profile-back-btn" id="detail-back-btn">←</button>
      <h2>${profile.name}</h2>
    </div>
    <div class="profile-stats-bar">
      <div class="profile-stat"><div class="profile-stat-value">${s.total}</div><div class="profile-stat-label">Total</div></div>
      <div class="profile-stat"><div class="profile-stat-value">${s.thisMonth}</div><div class="profile-stat-label">This month</div></div>
      <div class="profile-stat">
        <div class="profile-stat-value">${s.lastTier ? `<span class="assessment-tier-badge ${tierClass(s.lastTier)}">${s.lastTier}</span>` : '—'}</div>
        <div class="profile-stat-label">Last tier</div>
      </div>
    </div>
    <div id="detail-assessment-list"></div>
    <button type="button" class="profile-edit-btn" id="detail-edit-btn">Edit profile</button>`;

  root.querySelector('#detail-back-btn').addEventListener('click', () => renderProfilesScreen());
  root.querySelector('#detail-edit-btn').addEventListener('click', () => renderProfileForm(profile.id));

  const list = root.querySelector('#detail-assessment-list');
  if (profile.assessments.length === 0) {
    list.innerHTML = `<p class="history-empty">No assessments yet</p><p class="history-empty">Tap Assess to get started</p>`;
    return;
  }
  profile.assessments.forEach(a => {
    const row = document.createElement('div');
    row.className = 'assessment-list-entry';
    row.innerHTML = `
      <span class="assessment-tier-badge ${tierClass(a.tier)}">${a.tier}</span>
      <div class="assessment-list-center">
        <div class="assessment-list-disease">${a.topDisease || a.ruleId || a.tier}</div>
        <div class="assessment-list-date">${new Date(a.timestamp).toLocaleString()}</div>
      </div>
      <div class="assessment-list-explanation">${a.explanation || ''}</div>`;
    row.addEventListener('click', () => openAssessmentDetail(profile.id, a.id));
    list.appendChild(row);
  });
}

function tierClass(tier) {
  if (tier === 'EMERGENCY') return 'emergency';
  if (tier === 'URGENT') return 'urgent';
  return 'routine';
}

// --- Screen 4: full assessment detail (bottom sheet) ---

let currentDetailAssessmentId = null;

function openAssessmentDetail(profileId, assessmentId) {
  currentDetailAssessmentId = assessmentId;
  const profile = loadProfiles().find(p => p.id === profileId);
  const a = profile?.assessments.find(x => x.id === assessmentId);
  if (!a) return;

  const overlay = document.getElementById('assessment-sheet-overlay');
  const body = document.getElementById('assessment-sheet-body');

  let html = `<div class="banner banner-${tierClass(a.tier)}"><div class="banner-title">${a.tier}</div></div>`;
  html += `<p class="assessment-detail-timestamp">${new Date(a.timestamp).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>`;

  html += `<div class="assessment-detail-section"><div class="assessment-detail-label">Symptoms reported</div>`;
  html += a.symptoms.map(s => `<span class="readonly-chip">${s}</span>`).join('');
  html += `</div>`;

  const v = a.vitals || {};
  if (v.temp_c != null || v.pulse_bpm != null || v.breathing_rpm != null) {
    html += `<div class="assessment-detail-section"><div class="assessment-detail-label">Vitals</div>`;
    if (v.temp_c != null) html += `<span class="readonly-chip">Temp: ${v.temp_c}°C</span>`;
    if (v.pulse_bpm != null) html += `<span class="readonly-chip">Pulse: ${v.pulse_bpm} bpm</span>`;
    if (v.breathing_rpm != null) html += `<span class="readonly-chip">Breathing: ${v.breathing_rpm}/min</span>`;
    html += `</div>`;
  }

  const activeRiskFactors = Object.entries(a.riskFactors || {}).filter(([, on]) => on).map(([k]) => k);
  if (activeRiskFactors.length > 0) {
    html += `<div class="assessment-detail-section"><div class="assessment-detail-label">Risk factors</div>`;
    html += activeRiskFactors.map(f => `<span class="readonly-chip">${f}</span>`).join('');
    html += `</div>`;
  }

  if (a.explanation) {
    html += `<div class="assessment-detail-section"><div class="assessment-detail-label">Explanation</div><p>${a.explanation}</p></div>`;
  }

  if (a.differential && a.differential.length > 0) {
    html += `<div class="assessment-detail-section"><div class="assessment-detail-label">Differential</div>`;
    a.differential.slice(0, 3).forEach(d => {
      const pct = Math.round(d.probability * 100);
      html += `<div class="diff-entry"><div class="diff-top"><span class="diff-name">${d.disease}</span><span class="diff-pct">${pct}%</span></div>
        <div class="diff-bar-track"><div class="diff-bar" style="width:${Math.max(2, pct)}%"></div></div></div>`;
    });
    html += `</div>`;
  }

  if (a.location) {
    const label = a.location.label || 'Location recorded';
    html += `<div class="assessment-detail-section">
      <div class="assessment-detail-label">📍 ${label}</div>
      <a class="assessment-map-link" href="https://www.google.com/maps/@${a.location.lat},${a.location.lng},16z" target="_blank" rel="noopener">View on map</a>
    </div>`;
  }

  body.innerHTML = html;
  overlay.hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('assessment-sheet-close');
  const overlay = document.getElementById('assessment-sheet-overlay');
  if (closeBtn) closeBtn.addEventListener('click', () => { overlay.hidden = true; currentDetailAssessmentId = null; });
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.hidden = true; currentDetailAssessmentId = null; }
  });
});

// --- Toast ---

export function showToast(message, actionLabel, onAction) {
  const toast = document.getElementById('toast');
  toast.innerHTML = `<span>${message}</span>`;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { toast.hidden = true; if (onAction) onAction(); });
    toast.appendChild(btn);
  }
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 6000);
}

// --- Wiring entry point, called once from app.js ---

export function initProfileSystem(switchToProfilesTabFn) {
  switchToProfilesTab = switchToProfilesTabFn;
  renderProfileHeader();
}
