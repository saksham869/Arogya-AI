// Vendored locally (not the CDN URL task.md's code uses) so the wasm
// runtime is actually precached by the service worker and the offline
// demo doesn't depend on browser HTTP-cache behaviour. See
// scripts/vendor_onnxruntime.sh and AD-10.
import * as ort from './vendor/ort.min.js';
// Resolve from this module's own URL, not the page's -- a plain relative
// string is resolved against the *page* location by onnxruntime-web,
// which breaks as soon as infer.js doesn't live next to index.html.
ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
// This server has no COOP/COEP headers, so cross-origin isolation isn't
// available and the threaded wasm build can't be used -- only ort-wasm-simd.wasm
// (single-threaded) was vendored. Force numThreads=1 to stop onnxruntime-web
// from warning about / attempting the threaded path.
ort.env.wasm.numThreads = 1;

let session = null;
let attr = null;
let symptoms_list = null;
let red_flags = null;

// Split from the ONNX session load: red_flags.json is a few KB, the ONNX
// runtime is a ~10MB wasm binary. S4 says the model is not called when a
// red flag fires -- that should also mean not paying wasm-compile latency
// on the emergency path, so this loads only what checkRedFlags() needs.
async function initRedFlagData() {
  if (red_flags) return;
  [attr, symptoms_list, red_flags] = await Promise.all([
    fetch('./data/attributions.json').then(r => r.json()),
    fetch('./data/symptoms.json').then(r => r.json()),
    fetch('./data/red_flags.json').then(r => r.json()),
  ]);
}

export async function init() {
  await initRedFlagData();
  if (!session) {
    session = await ort.InferenceSession.create('./models/arogya.onnx');
  }
}

function buildFeatureVector(selectedSymptoms, ageYears, sex) {
  const vec = new Float32Array(139).fill(0);
  // Symptoms (0-130)
  selectedSymptoms.forEach(s => {
    const i = symptoms_list.indexOf(s);
    if (i >= 0) vec[i] = 1;
  });
  // Age bands (131-137), one-hot
  const bands = [[0,1],[1,5],[5,12],[12,18],[18,40],[40,60],[60,200]];
  const bi = bands.findIndex(([lo,hi]) => ageYears >= lo && ageYears < hi);
  if (bi >= 0) vec[131 + bi] = 1;
  // Sex (138)
  vec[138] = attr.sex_encoding[sex] ?? 0.5;
  return vec;
}

function checkRedFlags(selectedSymptoms, ageYears, sex, riskFactors, vitals) {
  const sympSet = new Set(selectedSymptoms);
  const ageMonths = ageYears * 12;
  for (const rule of red_flags) {
    if (!rule.all_of.every(s => sympSet.has(s))) continue;
    if (rule.any_of && !rule.any_of.some(s => sympSet.has(s))) continue;
    if (rule.age_max_months && ageMonths > rule.age_max_months) continue;
    if (rule.age_min_years && ageYears < rule.age_min_years) continue;
    if (rule.risk_factor_required && !riskFactors[rule.risk_factor_required]) continue;
    if (rule.vital_temp_above && (!vitals.temp_c || vitals.temp_c <= rule.vital_temp_above)) continue;
    if (rule.vital_pulse_above && (!vitals.pulse_bpm || vitals.pulse_bpm <= rule.vital_pulse_above)) continue;
    return { fired: true, tier: rule.tier, ruleId: rule.id,
             rationale: rule.rationale_en, action: rule.action_en };
  }
  return { fired: false };
}

function computeAllSHAP(featureVector) {
  const result = {};
  for (let ci = 0; ci < attr.classes.length; ci++) {
    const phi = attr.coef[ci].map((b, i) => b * (featureVector[i] - attr.mean[i]));
    result[attr.classes[ci]] = phi
      .map((v, i) => ({ symptomId: attr.symptoms[i] || `age_band_${i-131}`, contribution: v, present: featureVector[i] === 1 }))
      .filter(d => d.present)
      .sort((a, b) => b.contribution - a.contribution);
  }
  return result;
}

export async function predict(selectedSymptoms, ageYears, sex, riskFactors = {}, vitals = {}, uncertainSymptoms = new Set()) {
  // 1. Red-flag check FIRST (S4) -- loads only the small rule data, not the
  // ONNX session, so an emergency result never waits on wasm compilation.
  // Uncertain ("Not sure") symptoms still count here: S5 says red flags may
  // only escalate, and a possibly-present danger sign is safer to still
  // check for than to silently drop -- F12 only asks that they be excluded
  // from the model's feature vector, not from the rule engine.
  await initRedFlagData();
  const rf = checkRedFlags(selectedSymptoms, ageYears, sex, riskFactors, vitals);
  if (rf.fired) {
    return { tier: rf.tier, tierSource: 'red_flag', ruleId: rf.ruleId,
             rationale: rf.rationale, action: rf.action,
             differential: [], explanation: [], allShap: {} };
  }

  // Only now do we need the model.
  if (!session) session = await ort.InferenceSession.create('./models/arogya.onnx');

  // 2. Build feature vector (F12: uncertain symptoms excluded here only)
  const certainSymptoms = selectedSymptoms.filter(s => !uncertainSymptoms.has(s));
  const vec = buildFeatureVector(certainSymptoms, ageYears, sex);

  // 3. Run ONNX
  const tensor = new ort.Tensor('float32', vec, [1, 139]);
  const output = await session.run({ float_input: tensor });
  const probs = Array.from(output.probabilities.data);

  // 4. Compute SHAP for all classes (AD-4)
  const allShap = computeAllSHAP(vec);

  // 5. Top-3 differential
  const top3 = probs
    .map((p, i) => ({ disease: attr.classes[i], probability: p }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  const topClass = top3[0].disease;
  const explanation = (allShap[topClass] || []).slice(0, 5);

  // 6. Severity tier
  let tier = 'ROUTINE';
  // (severity.json loaded separately by app.js)

  return { tier, tierSource: 'model', ruleId: null, rationale: null, action: null,
           differential: top3, explanation, allShap, topClass };
}
