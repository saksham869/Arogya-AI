import json, csv, os, sys
# Makes `python scripts/run_vignettes.py` work regardless of invocation
# style -- without this, importing src.* fails with ModuleNotFoundError
# because Python puts the script's own directory (scripts/), not the repo
# root, on sys.path when run this way.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.rules.engine import evaluate, get_triage
import joblib, numpy as np

saved = joblib.load('models/lr.joblib')
clf = saved['model']
symptoms_list = saved['symptom_cols']
manifest = json.load(open('data/processed/data_manifest.json'))

results = []
with open('vignettes/vignettes.csv') as f:
    for row in csv.DictReader(f):
        syms = set(row['symptoms'].split('|'))
        age = float(row['age_years'])
        sex = row['sex']
        rf = json.loads(row['risk_factors'])
        vitals = json.loads(row['vitals'])
        expected = row['expected_tier']

        # Red-flag check
        tier, rule_id = evaluate(syms, age, sex, rf, vitals)
        source = 'red_flag'
        if tier is None:
            vec = np.zeros((1, 139), dtype=np.float32)
            for s in syms:
                i = symptoms_list.index(s) if s in symptoms_list else -1
                if i >= 0: vec[0, i] = 1.0
            pred_disease = clf.predict(vec)[0]
            tier = get_triage(pred_disease, 0)
            source = 'model'

        correct = tier == expected
        results.append({'id': row['id'], 'expected': expected, 'got': tier, 'source': source, 'correct': correct})
        print(f"{row['id']} {'✓' if correct else '✗'} expected={expected} got={tier} ({source})")

# Metrics
emergency = [r for r in results if r['expected'] == 'EMERGENCY']
tp = sum(r['got'] == 'EMERGENCY' for r in emergency)
recall = tp / len(emergency) if emergency else 0

non_emerg = [r for r in results if r['expected'] != 'EMERGENCY']
overtriage = sum(r['got'] == 'EMERGENCY' for r in non_emerg) / len(non_emerg) if non_emerg else 0

print(f"\nEmergency recall: {tp}/{len(emergency)} = {recall:.1%}")
print(f"Over-triage rate: {overtriage:.1%}")
print(f"Benchmark: commercial checkers 76.9%, physicians 85.7%")

md = f"# Vignette Results\nDate: {__import__('datetime').date.today()}\n\n"
md += "| ID | Expected | Got | Source | Result |\n|---|---|---|---|---|\n"
for r in results:
    md += f"| {r['id']} | {r['expected']} | {r['got']} | {r['source']} | {'✓' if r['correct'] else '✗'} |\n"
md += f"\n**Emergency recall:** {tp}/{len(emergency)} = {recall:.1%} (benchmark: commercial 76.9%, physicians 85.7%)\n"
md += f"**Over-triage rate:** {overtriage:.1%}\n"
open('results/vignettes.md', 'w').write(md)
print("\nSaved to results/vignettes.md")
