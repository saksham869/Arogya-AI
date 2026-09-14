import yaml
from pathlib import Path

_rules = None
_severity = None

def _load():
    global _rules, _severity
    if _rules is None:
        _rules = yaml.safe_load(Path('src/rules/red_flags.yaml').read_text())
        _severity = yaml.safe_load(Path('src/rules/severity.yaml').read_text())

def evaluate(symptoms: set, age_years: float, sex: str,
             risk_factors: dict = None, vitals: dict = None):
    """
    Returns (tier, rule_id) if a red flag fires, else (None, None).
    symptoms: set of symptom IDs (strings)
    age_years: float (e.g. 0.25 for 3-month-old)
    sex: 'M', 'F', or 'O'
    risk_factors: dict of {condition: bool}, e.g. {'heart_disease': True}
    vitals: dict of {temp_c, pulse_bpm, breathing_rpm}, all optional floats
    """
    _load()
    if risk_factors is None: risk_factors = {}
    if vitals is None: vitals = {}
    age_months = age_years * 12

    for rule in _rules:
        # Check all_of
        if not all(s in symptoms for s in rule.get('all_of', [])):
            continue
        # Check any_of
        if 'any_of' in rule and not any(s in symptoms for s in rule['any_of']):
            continue
        # Check age
        if 'age_max_months' in rule and age_months > rule['age_max_months']:
            continue
        if 'age_min_years' in rule and age_years < rule['age_min_years']:
            continue
        # Check risk factor
        if 'risk_factor_required' in rule:
            if not risk_factors.get(rule['risk_factor_required'], False):
                continue
        # Check vitals
        if 'vital_temp_above' in rule:
            temp = vitals.get('temp_c')
            if temp is None or temp <= rule['vital_temp_above']:
                continue
        if 'vital_pulse_above' in rule:
            pulse = vitals.get('pulse_bpm')
            if pulse is None or pulse <= rule['vital_pulse_above']:
                continue
        # All conditions met
        return (rule['tier'], rule['id'])
    return (None, None)

def get_triage(disease, model_prob):
    """Returns triage tier for a given disease based on severity map."""
    _load()
    return _severity.get(disease, 'ROUTINE')
