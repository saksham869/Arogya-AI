from src.rules.engine import evaluate

ADULT = dict(age_years=30, sex='M')


def test_empty_symptom_set_never_fires():
    assert evaluate(set(), **ADULT) == (None, None)


# --- RF01: chest_pain + (breathlessness|sweating|vomiting) ---

def test_rf01_fires():
    tier, rule_id = evaluate({'chest_pain', 'breathlessness'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF01')


def test_rf01_near_miss_chest_pain_alone():
    assert evaluate({'chest_pain'}, **ADULT) == (None, None)


# --- RF01b: chest_pain + heart_disease risk factor ---

def test_rf01b_fires():
    tier, rule_id = evaluate({'chest_pain'}, **ADULT, risk_factors={'heart_disease': True})
    assert (tier, rule_id) == ('EMERGENCY', 'RF01b')


def test_rf01b_near_miss_risk_factor_false():
    result = evaluate({'chest_pain'}, **ADULT, risk_factors={'heart_disease': False})
    assert result == (None, None)


# --- RF02: breathlessness + (chest_pain|high_fever) ---

def test_rf02_fires():
    tier, rule_id = evaluate({'breathlessness', 'high_fever'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF02')


def test_rf02_near_miss_breathlessness_alone():
    assert evaluate({'breathlessness'}, **ADULT) == (None, None)


# --- RF03: loss_of_consciousness (UI-only symptom, not in the 131-symptom set) ---

def test_rf03_fires():
    tier, rule_id = evaluate({'loss_of_consciousness'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF03')


def test_rf03_near_miss():
    assert evaluate({'headache'}, **ADULT) == (None, None)


# --- RF04: weakness_in_limbs + (headache|vomiting|altered_sensorium) ---

def test_rf04_fires():
    tier, rule_id = evaluate({'weakness_in_limbs', 'headache'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF04')


def test_rf04_near_miss_weakness_alone():
    assert evaluate({'weakness_in_limbs'}, **ADULT) == (None, None)


# --- RF05: stiff_neck + high_fever ---

def test_rf05_fires():
    tier, rule_id = evaluate({'stiff_neck', 'high_fever'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF05')


def test_rf05_near_miss_stiff_neck_alone():
    assert evaluate({'stiff_neck'}, **ADULT) == (None, None)


# --- RF06: high_fever + skin_rash ---

def test_rf06_fires():
    tier, rule_id = evaluate({'high_fever', 'skin_rash'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF06')


def test_rf06_near_miss_rash_alone():
    assert evaluate({'skin_rash'}, **ADULT) == (None, None)


# --- RF07: high_fever + age_max_months=3 ---

def test_rf07_fires_for_young_infant():
    tier, rule_id = evaluate({'high_fever'}, age_years=0.1, sex='F')
    assert (tier, rule_id) == ('EMERGENCY', 'RF07')


def test_rf07_near_miss_older_child():
    result = evaluate({'high_fever'}, age_years=5, sex='F')
    assert result == (None, None)


# --- RF-TEMP01 (must fire before RF08's unconditional match) / RF08 ---

def test_rf_temp01_fires_with_high_temperature():
    tier, rule_id = evaluate({'altered_sensorium'}, **ADULT, vitals={'temp_c': 40.0})
    assert (tier, rule_id) == ('EMERGENCY', 'RF-TEMP01')


def test_rf08_fires_when_temperature_not_above_threshold():
    # altered_sensorium alone is still an emergency (RF08) even though the
    # temperature isn't high enough to trigger the more specific RF-TEMP01.
    tier, rule_id = evaluate({'altered_sensorium'}, **ADULT, vitals={'temp_c': 38.0})
    assert (tier, rule_id) == ('EMERGENCY', 'RF08')


def test_rf08_fires_with_no_vitals_given():
    tier, rule_id = evaluate({'altered_sensorium'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF08')


def test_rf08_near_miss_no_altered_sensorium():
    assert evaluate({'headache'}, **ADULT) == (None, None)


# --- RF09: bloody_stool + (vomiting|abdominal_pain) ---

def test_rf09_fires():
    tier, rule_id = evaluate({'bloody_stool', 'vomiting'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF09')


def test_rf09_near_miss_bloody_stool_alone():
    assert evaluate({'bloody_stool'}, **ADULT) == (None, None)


# --- RF10: vomiting + (chest_pain|breathlessness) ---
# Uses breathlessness (not chest_pain) so this doesn't also satisfy RF01,
# which would otherwise fire first since RF01 precedes RF10.

def test_rf10_fires():
    tier, rule_id = evaluate({'vomiting', 'breathlessness'}, **ADULT)
    assert (tier, rule_id) == ('EMERGENCY', 'RF10')


def test_rf10_near_miss_vomiting_alone():
    assert evaluate({'vomiting'}, **ADULT) == (None, None)


# --- RF-PULSE01: breathlessness + pulse > 120 ---

def test_rf_pulse01_fires():
    tier, rule_id = evaluate({'breathlessness'}, **ADULT, vitals={'pulse_bpm': 130})
    assert (tier, rule_id) == ('EMERGENCY', 'RF-PULSE01')


def test_rf_pulse01_near_miss_pulse_not_above_threshold():
    result = evaluate({'breathlessness'}, **ADULT, vitals={'pulse_bpm': 90})
    assert result == (None, None)


def test_rf_pulse01_near_miss_no_pulse_given():
    assert evaluate({'breathlessness'}, **ADULT) == (None, None)


# --- RF-PREG01: abdominal_pain + pregnancy risk factor ---

def test_rf_preg01_fires():
    tier, rule_id = evaluate({'abdominal_pain'}, age_years=28, sex='F',
                              risk_factors={'pregnancy': True})
    assert (tier, rule_id) == ('EMERGENCY', 'RF-PREG01')


def test_rf_preg01_near_miss_not_pregnant():
    result = evaluate({'abdominal_pain'}, age_years=28, sex='F',
                       risk_factors={'pregnancy': False})
    assert result == (None, None)
