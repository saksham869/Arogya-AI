import json

from fastapi.testclient import TestClient

from src.api.main import app

client = TestClient(app)

# S1 regression guard: common medication names relevant to conditions in
# this dataset. The system has no medication data at all, so this list
# should never appear -- this test exists to catch the day someone adds
# some and forgets S1, per the correction table ("S1 -> you named a
# medication. Remove it. Add a test preventing recurrence.").
MEDICATION_NAMES = [
    "paracetamol", "acetaminophen", "ibuprofen", "aspirin", "amoxicillin",
    "azithromycin", "metformin", "insulin", "omeprazole", "cetirizine",
    "doxycycline", "chloroquine", "artemisinin", "ceftriaxone",
    "loratadine", "metronidazole", "ors", "zinc sulfate", "tylenol",
    "advil", "crocin", "dolo",
]


def assert_no_medication_names(response_json):
    text = json.dumps(response_json).lower()
    found = [name for name in MEDICATION_NAMES if name in text]
    assert not found, f"medication name(s) leaked into response: {found}"


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["n_diseases"] == 41


def test_predict_red_flag_case():
    res = client.post("/predict", json={
        "symptoms": ["chest_pain", "breathlessness"],
        "age_years": 52, "sex": "M", "lang": "en",
    })
    assert res.status_code == 200
    body = res.json()
    assert body["tier"] == "EMERGENCY"
    assert body["tier_source"] == "red_flag"
    assert body["rule_id"] == "RF01"
    assert body["differential"] == []
    assert body["explanation"] == []
    assert body["disclaimer"]
    assert_no_medication_names(body)


def test_predict_model_case():
    res = client.post("/predict", json={
        "symptoms": ["itching", "skin_rash"],
        "age_years": 34, "sex": "M", "lang": "en",
    })
    assert res.status_code == 200
    body = res.json()
    assert body["tier_source"] == "model"
    assert body["rule_id"] is None
    assert len(body["differential"]) == 3
    assert all(d["confidence_band"] in ("Likely", "Possible", "Uncertain") for d in body["differential"])
    assert body["disclaimer"]
    assert_no_medication_names(body)


def test_predict_red_flag_never_calls_model_fields_empty():
    # Complements S4's real guarantee (checked at the infer.js level via
    # the browser's network log in 6-A3) -- here, verifies the response
    # contract itself never carries model-path fields on a red-flag hit.
    res = client.post("/predict", json={
        "symptoms": ["loss_of_consciousness"], "age_years": 40, "sex": "F", "lang": "en",
    })
    body = res.json()
    assert body["tier_source"] == "red_flag"
    assert body["differential"] == []
    assert body["why_not_others"] == []


def test_predict_hindi_rationale():
    res = client.post("/predict", json={
        "symptoms": ["chest_pain", "breathlessness"],
        "age_years": 52, "sex": "M", "lang": "hi",
    })
    body = res.json()
    assert body["rationale"] == "इन लक्षणों के साथ सीने में दर्द दिल के दौरे का संकेत हो सकता है।"


def test_predict_no_medication_names_across_varied_inputs():
    cases = [
        {"symptoms": ["high_fever", "chills", "vomiting"], "age_years": 55, "sex": "M",
         "risk_factors": {"diabetes": True}},
        {"symptoms": ["cough", "breathlessness"], "age_years": 38, "sex": "M"},
        {"symptoms": ["fatigue", "yellowing_of_eyes"], "age_years": 27, "sex": "F"},
        {"symptoms": ["back_pain"], "age_years": 40, "sex": "M"},
    ]
    for case in cases:
        res = client.post("/predict", json=case)
        assert res.status_code == 200
        assert_no_medication_names(res.json())
