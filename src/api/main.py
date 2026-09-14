from pathlib import Path

import joblib
import numpy as np
import yaml
from fastapi import FastAPI

from src.api.schemas import (
    DifferentialEntry,
    ExplanationEntry,
    HealthResponse,
    PredictRequest,
    PredictResponse,
    WhyNotOtherEntry,
)
from src.rules.engine import evaluate, get_triage

app = FastAPI(title="ArogyaAI API")

DISCLAIMER = "This is not a diagnosis. This is not a medical device. It does not replace a doctor."
N_FEATURES = 139
AGE_BANDS = [(0, 1), (1, 5), (5, 12), (12, 18), (18, 40), (40, 60), (60, 200)]
SEX_ENCODING = {"M": 0.0, "F": 1.0, "O": 0.5}

_saved = joblib.load("models/lr.joblib")
_clf = _saved["model"]
_symptom_cols = _saved["symptom_cols"]
_classes = list(_clf.classes_)
_coef = _clf.coef_
_mean = _saved["feature_means"]

_red_flag_rules = yaml.safe_load(Path("src/rules/red_flags.yaml").read_text())
_rules_by_id = {r["id"]: r for r in _red_flag_rules}


def build_feature_vector(symptoms: set, age_years: float, sex: str) -> np.ndarray:
    vec = np.zeros(N_FEATURES, dtype=np.float32)
    for s in symptoms:
        if s in _symptom_cols:
            vec[_symptom_cols.index(s)] = 1.0
    for i, (lo, hi) in enumerate(AGE_BANDS):
        if lo <= age_years < hi:
            vec[len(_symptom_cols) + i] = 1.0
            break
    vec[len(_symptom_cols) + len(AGE_BANDS)] = SEX_ENCODING.get(sex, 0.5)
    return vec


def confidence_band(p: float) -> str:
    if p > 0.6:
        return "Likely"
    if p >= 0.3:
        return "Possible"
    return "Uncertain"


def compute_all_shap(vec: np.ndarray) -> dict:
    """AD-4: phi_i = coef[ci][i] * (x_i - mean_i), present features only, sorted desc."""
    result = {}
    for ci, disease in enumerate(_classes):
        phi = _coef[ci] * (vec - _mean)
        entries = [
            {"symptom": _symptom_cols[i] if i < len(_symptom_cols) else f"age_band_{i - len(_symptom_cols)}",
             "contribution": float(phi[i]), "present": bool(vec[i] == 1)}
            for i in range(N_FEATURES)
            if vec[i] == 1
        ]
        entries.sort(key=lambda e: e["contribution"], reverse=True)
        result[disease] = entries
    return result


def why_not_other(top_class: str, other_class: str, all_shap: dict) -> str | None:
    """AD-4: the symptom that drove top_class but not other_class, if any."""
    if not all_shap[top_class]:
        return None
    top_top = all_shap[top_class][0]
    other_score = next((e for e in all_shap[other_class] if e["symptom"] == top_top["symptom"]), None)
    if other_score is None or other_score["contribution"] < 0.01:
        return top_top["symptom"]
    return None


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", n_diseases=len(_classes), model_version="lr-v1")


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    symptoms = set(req.symptoms)
    risk_factors = req.risk_factors
    vitals = {k: v for k, v in req.vitals.model_dump().items() if v is not None}

    # 1. Red-flag check FIRST (S4) -- model is not called if a rule fires.
    tier, rule_id = evaluate(symptoms, req.age_years, req.sex, risk_factors, vitals)
    if tier is not None:
        rule = _rules_by_id[rule_id]
        rationale = rule["rationale_hi"] if req.lang == "hi" else rule["rationale_en"]
        action = rule["action_hi"] if req.lang == "hi" else rule["action_en"]
        return PredictResponse(
            tier=tier, tier_source="red_flag", rule_id=rule_id,
            rationale=rationale, action=action,
            differential=[], explanation=[], why_not_others=[],
            disclaimer=DISCLAIMER,
        )

    # 2. Model path.
    vec = build_feature_vector(symptoms, req.age_years, req.sex)
    proba = _clf.predict_proba(vec.reshape(1, -1))[0]
    top3_idx = np.argsort(proba)[::-1][:3]
    differential = [
        DifferentialEntry(disease=_classes[i], probability=float(proba[i]), confidence_band=confidence_band(proba[i]))
        for i in top3_idx
    ]
    top_class = _classes[top3_idx[0]]

    all_shap = compute_all_shap(vec)
    explanation = [
        ExplanationEntry(symptom=e["symptom"], contribution=e["contribution"])
        for e in all_shap[top_class][:5]
        if not e["symptom"].startswith("age_band_")
    ]
    why_not_others = [
        WhyNotOtherEntry(disease=_classes[i], reason=why_not_other(top_class, _classes[i], all_shap))
        for i in top3_idx[1:]
    ]

    model_tier = get_triage(top_class, 0)

    return PredictResponse(
        tier=model_tier, tier_source="model", rule_id=None, rationale=None, action=None,
        differential=differential, explanation=explanation, why_not_others=why_not_others,
        disclaimer=DISCLAIMER,
    )
