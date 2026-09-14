import { STRINGS } from './strings.js';

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

function renderDifferentialEntry(entry, lang) {
  const t = STRINGS[lang];
  const row = document.createElement('div');
  row.className = 'diff-entry';

  const top = document.createElement('div');
  top.className = 'diff-top';
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
    // Expander shell only for now -- whyNotOther() wiring + copy is 6-B4 (F10).
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'why-ranked-lower';
    toggle.textContent = t.whyRankedLower;
    const detail = document.createElement('div');
    detail.className = 'why-ranked-lower-detail';
    detail.hidden = true;
    toggle.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    row.appendChild(toggle);
    row.appendChild(detail);
  }

  return row;
}

export function renderResult(result, lang, onStartOver) {
  const t = STRINGS[lang];
  const container = document.getElementById('results');
  container.innerHTML = '';

  const banner = document.createElement('div');
  banner.className = `banner banner-${tierClass(result.tier)}`;

  const bannerTitle = document.createElement('div');
  bannerTitle.className = 'banner-title';
  bannerTitle.textContent = t.tierBanner[result.tier] || result.tier;
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

      result.differential.forEach((entry, i) => {
        container.appendChild(renderDifferentialEntry({ ...entry, isTop: i === 0 }, lang));
      });
    }
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
