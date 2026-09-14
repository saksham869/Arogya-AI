import { STRINGS } from './strings.js';
import { openSheet } from './sheet.js';

function tierClass(tier) {
  if (tier === 'EMERGENCY') return 'emergency';
  if (tier === 'URGENT') return 'urgent';
  return 'routine';
}

function naturalJoin(items, andWord) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${andWord} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} ${andWord} ${items[items.length - 1]}`;
}

// F2: plain-language explanation from the top SHAP contributors. Only real
// symptom ids are named -- age-band/sex feature "contributors" are an
// artefact of those columns being zero-padded during training (see
// src/models/train.py) and never carry a meaningful learned signal, so
// naming one here would be confusing, not explanatory.
function explanationSentence(result, lang) {
  const t = STRINGS[lang];
  const names = result.explanation
    .filter(e => e.present && !e.symptomId.startsWith('age_band_'))
    .map(e => e.symptomId);
  if (names.length === 0) return '';
  return t.becauseYouReported(naturalJoin(names, t.and));
}

// AD-4: which symptom drove the top class but not this one, if any.
function whyNotOther(topClass, otherClass, allShap) {
  const topTop = allShap[topClass][0];
  const otherScore = allShap[otherClass].find(d => d.symptomId === topTop.symptomId);
  if (!otherScore || otherScore.contribution < 0.01) {
    return topTop.symptomId;
  }
  return null;
}

// F20: 2-sentence description + when_to_see + common symptoms, in the
// current language, from condition_info.json.
function showConditionInfo(disease, lang, conditionInfo) {
  const info = conditionInfo[disease];
  if (!info) return;
  const desc = lang === 'hi' ? info.hi : info.en;
  const whenToSee = lang === 'hi' ? info.when_to_see_hi : info.when_to_see_en;
  const symptoms = (info.common_symptoms || []).join(', ');
  openSheet(`
    <h3>${disease}</h3>
    <p>${desc}</p>
    <p><strong>${whenToSee}</strong></p>
    ${symptoms ? `<p class="sheet-common-symptoms">${symptoms}</p>` : ''}
  `);
}

function renderDifferentialEntry(entry, lang, result, conditionInfo) {
  const t = STRINGS[lang];
  const row = document.createElement('div');
  row.className = 'diff-entry';

  const top = document.createElement('div');
  top.className = 'diff-top diff-top-tappable';
  top.addEventListener('click', () => showConditionInfo(entry.disease, lang, conditionInfo));
  const name = document.createElement('span');
  name.className = 'diff-name';
  name.textContent = entry.disease;
  const pct = document.createElement('span');
  pct.className = 'diff-pct';
  pct.textContent = `${Math.round(entry.probability * 100)}%`;
  top.appendChild(name);
  top.appendChild(pct);

  const barTrack = document.createElement('div');
  barTrack.className = 'diff-bar-track';
  const bar = document.createElement('div');
  bar.className = 'diff-bar';
  bar.style.width = `${Math.max(2, Math.round(entry.probability * 100))}%`;
  barTrack.appendChild(bar);

  row.appendChild(top);
  row.appendChild(barTrack);

  if (!entry.isTop) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'why-ranked-lower';
    toggle.textContent = t.whyRankedLower;
    const detail = document.createElement('div');
    detail.className = 'why-ranked-lower-detail';
    detail.hidden = true;
    let computed = false;
    toggle.addEventListener('click', () => {
      if (!computed) {
        const symptomId = whyNotOther(result.topClass, entry.disease, result.allShap);
        detail.textContent = symptomId
          ? t.rankedLowerBecause(symptomId)
          : t.similarPatternTo(result.topClass);
        computed = true;
      }
      detail.hidden = !detail.hidden;
    });
    row.appendChild(toggle);
    row.appendChild(detail);
  }

  return row;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderPHCEntry(phc, lang, distanceKm) {
  const row = document.createElement('div');
  row.className = 'phc-entry';
  const info = document.createElement('div');
  info.className = 'phc-info';
  const name = document.createElement('div');
  name.className = 'phc-name';
  name.textContent = phc.name;
  info.appendChild(name);
  if (distanceKm != null) {
    const dist = document.createElement('div');
    dist.className = 'phc-distance';
    dist.textContent = `${distanceKm.toFixed(1)} km`;
    info.appendChild(dist);
  } else {
    const addr = document.createElement('div');
    addr.className = 'phc-distance';
    addr.textContent = phc.address;
    info.appendChild(addr);
  }
  const callLink = document.createElement('a');
  callLink.className = 'phc-call-btn';
  callLink.href = `tel:${phc.phone}`;
  callLink.textContent = STRINGS[lang].call;
  row.appendChild(info);
  row.appendChild(callLink);
  return row;
}

// F17: top 3 nearest by Haversine distance on geolocation success, else all
// 10 as a plain list (no distances) -- called only for tier === EMERGENCY,
// whichever path (red flag or model+severity map) produced it.
function renderNearestPHC(container, lang, phcList) {
  if (!phcList || phcList.length === 0) return;
  const section = document.createElement('div');
  section.className = 'phc-section';
  const label = document.createElement('div');
  label.className = 'phc-section-label';
  label.textContent = STRINGS[lang].nearestCentres;
  section.appendChild(label);
  const list = document.createElement('div');
  list.className = 'phc-list';
  section.appendChild(list);
  container.appendChild(section);

  function showAllPlain() {
    list.innerHTML = '';
    phcList.forEach(phc => list.appendChild(renderPHCEntry(phc, lang, null)));
  }

  if (!navigator.geolocation) {
    showAllPlain();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const top3 = phcList
        .map(phc => ({ phc, distanceKm: haversineKm(latitude, longitude, phc.lat, phc.lng) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 3);
      list.innerHTML = '';
      top3.forEach(({ phc, distanceKm }) => list.appendChild(renderPHCEntry(phc, lang, distanceKm)));
    },
    () => showAllPlain()
  );
}

// F13's thresholds, used here ahead of that feature's own UI (6-C4) so the
// print card doesn't ship an incomplete field; 6-C4 reuses this helper.
export function confidenceBand(probability, lang) {
  const t = STRINGS[lang];
  if (probability > 0.6) return t.confidenceLikely;
  if (probability >= 0.3) return t.confidencePossible;
  return t.confidenceUncertain;
}

function buildPrintCard(result, lang, phcList, formSnapshot) {
  const t = STRINGS[lang];
  const card = document.createElement('div');
  card.className = 'print-card';

  const title = document.createElement('h2');
  title.textContent = 'ArogyaAI';
  card.appendChild(title);

  const rows = [
    [t.printDateTime, new Date().toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')],
    [t.printSymptoms, formSnapshot.symptoms.length ? formSnapshot.symptoms.join(', ') : t.none],
    [t.printAgeSex, `${formSnapshot.ageYears} / ${formSnapshot.sex}`],
  ];
  const vitalsEntered = Object.entries(formSnapshot.vitals).filter(([, v]) => v != null);
  if (vitalsEntered.length > 0) {
    rows.push([t.printVitals, vitalsEntered.map(([k, v]) => `${k}: ${v}`).join(', ')]);
  }
  const rfEntered = Object.entries(formSnapshot.riskFactors).filter(([, v]) => v);
  if (rfEntered.length > 0) {
    rows.push([t.printRiskFactors, rfEntered.map(([k]) => t.riskFactorLabels[k] || k).join(', ')]);
  }
  rows.push([t.printTier, t.tierBanner[result.tier] || result.tier]);

  rows.forEach(([label, value]) => {
    const row = document.createElement('p');
    row.innerHTML = `<strong>${label}:</strong> `;
    row.appendChild(document.createTextNode(value));
    card.appendChild(row);
  });

  if (result.tierSource === 'red_flag') {
    const p = document.createElement('p');
    p.textContent = `${result.rationale} ${result.action}`;
    card.appendChild(p);
  } else {
    const sentence = explanationSentence(result, lang);
    if (sentence) {
      const p = document.createElement('p');
      p.textContent = sentence;
      card.appendChild(p);
    }
    if (result.differential.length > 0) {
      const diffLabel = document.createElement('p');
      diffLabel.innerHTML = `<strong>${t.printDifferential}:</strong>`;
      card.appendChild(diffLabel);
      const list = document.createElement('ul');
      result.differential.forEach(entry => {
        const li = document.createElement('li');
        li.textContent = `${entry.disease} — ${confidenceBand(entry.probability, lang)}`;
        list.appendChild(li);
      });
      card.appendChild(list);
    }
  }

  const disclaimer = document.createElement('p');
  disclaimer.className = 'print-disclaimer';
  disclaimer.textContent = `⚠ ${t.disclaimer}`;
  card.appendChild(disclaimer);

  const footer = document.createElement('p');
  footer.className = 'print-footer';
  footer.textContent = t.printFooter;
  card.appendChild(footer);

  return card;
}

// F19: simplified Hindi tier labels, shown regardless of the language
// toggle whenever ASHA mode is on.
const ASHA_TIER_LABELS = {
  EMERGENCY: 'तुरंत अस्पताल जाएं',
  URGENT: 'आज डॉक्टर को दिखाएं',
  ROUTINE: 'घर पर देखभाल करें',
};

// F9: 2 generic follow-up questions for the top predicted disease. Answers
// only adjust a displayed confidence-band readout (reusing 6-B7's
// confidenceBand() helper) -- the model output and the real differential
// percentages never change, per this feature's own spec.
function renderFollowups(container, lang, result, followups) {
  const questions = followups[result.topClass];
  if (!questions || questions.length === 0) return;
  const t = STRINGS[lang];
  const topEntry = result.differential.find(d => d.disease === result.topClass);
  if (!topEntry) return;

  const section = document.createElement('div');
  section.className = 'followups-section';

  const deltas = new Array(questions.length).fill(0);
  const refined = document.createElement('p');
  refined.className = 'followups-refined';
  refined.hidden = true;

  function updateRefined() {
    const total = deltas.reduce((a, b) => a + b, 0);
    const adjusted = Math.min(1, Math.max(0, topEntry.probability + total));
    refined.textContent = `${t.refinedBasedOnAnswers}: ${confidenceBand(adjusted, lang)}`;
    refined.hidden = false;
  }

  questions.forEach((q, qi) => {
    const qBlock = document.createElement('div');
    qBlock.className = 'followup-question';
    const qText = document.createElement('p');
    qText.className = 'followup-q-text';
    qText.textContent = lang === 'hi' ? q.q_hi : q.q_en;
    qBlock.appendChild(qText);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'followup-options';
    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'followup-option';
      btn.textContent = lang === 'hi' ? opt.label_hi : opt.label_en;
      btn.addEventListener('click', () => {
        optionsRow.querySelectorAll('.followup-option').forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        deltas[qi] = opt.confidence_delta;
        updateRefined();
      });
      optionsRow.appendChild(btn);
    });
    qBlock.appendChild(optionsRow);
    section.appendChild(qBlock);
  });

  section.appendChild(refined);
  container.appendChild(section);
}

export function renderResult(result, lang, onStartOver, phcList = [], formSnapshot = null, ashaMode = false, conditionInfo = {}, followups = {}, profileName = null) {
  const t = STRINGS[lang];
  const container = document.getElementById('results');
  container.innerHTML = '';

  if (profileName) {
    const forLabel = document.createElement('p');
    forLabel.className = 'result-for-label';
    forLabel.textContent = `${t.forProfile}: ${profileName}`;
    container.appendChild(forLabel);
  }

  const banner = document.createElement('div');
  banner.className = `banner banner-${tierClass(result.tier)}`;

  const bannerTitle = document.createElement('div');
  bannerTitle.className = 'banner-title';
  bannerTitle.textContent = ashaMode
    ? (ASHA_TIER_LABELS[result.tier] || result.tier)
    : (t.tierBanner[result.tier] || result.tier);
  banner.appendChild(bannerTitle);

  if (result.tierSource === 'red_flag') {
    const rationale = document.createElement('p');
    rationale.className = 'banner-text';
    rationale.textContent = result.rationale;
    const action = document.createElement('p');
    action.className = 'banner-text banner-action';
    action.textContent = result.action;
    banner.appendChild(rationale);
    banner.appendChild(action);
    container.appendChild(banner);

    const notice = document.createElement('p');
    notice.className = 'safety-rule-notice';
    notice.textContent = t.safetyRuleNotice(result.ruleId);
    container.appendChild(notice);
    // S4: differential/explanation are intentionally not rendered here --
    // the model was not called, so there is nothing to show.
  } else {
    container.appendChild(banner);

    const sentence = explanationSentence(result, lang);
    if (sentence) {
      const p = document.createElement('p');
      p.className = 'explanation-sentence';
      p.textContent = sentence;
      container.appendChild(p);
    }

    if (result.differential.length > 0) {
      const causesLabel = document.createElement('div');
      causesLabel.className = 'possible-causes-label';
      causesLabel.textContent = t.possibleCauses;
      container.appendChild(causesLabel);

      // F19: ASHA mode collapses the differential to just the top entry.
      const shown = ashaMode ? result.differential.slice(0, 1) : result.differential;
      shown.forEach((entry, i) => {
        container.appendChild(renderDifferentialEntry({ ...entry, isTop: i === 0 }, lang, result, conditionInfo));
      });
    }

    renderFollowups(container, lang, result, followups);
  }

  if (result.tier === 'EMERGENCY') {
    renderNearestPHC(container, lang, phcList);
  }

  // F18: printable card. A previous card (e.g. from a prior language) is
  // removed first since this whole container was just cleared anyway --
  // only relevant if some future caller reuses the container without
  // clearing it first.
  document.querySelectorAll('.print-card').forEach(el => el.remove());
  if (formSnapshot) {
    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'save-for-doctor-btn';
    printBtn.textContent = t.saveForDoctor;
    printBtn.addEventListener('click', () => window.print());
    container.appendChild(printBtn);
    document.body.appendChild(buildPrintCard(result, lang, phcList, formSnapshot));
  }

  const startOverBtn = document.createElement('button');
  startOverBtn.type = 'button';
  startOverBtn.className = 'start-over-btn';
  startOverBtn.textContent = t.startOver;
  startOverBtn.addEventListener('click', () => {
    container.innerHTML = '';
    if (onStartOver) onStartOver();
  });
  container.appendChild(startOverBtn);
}
