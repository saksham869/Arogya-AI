import argparse
import pandas as pd, numpy as np, json, joblib
from datetime import date
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate
from sklearn.metrics import top_k_accuracy_score
from statsmodels.stats.proportion import proportion_confint
import warnings; warnings.filterwarnings('ignore')

parser = argparse.ArgumentParser()
parser.add_argument('--merged', action='store_true',
                    help='Use clean_merged.csv (773-dataset merge) instead of clean.csv')
args = parser.parse_args()

data_file = 'data/processed/clean_merged.csv' if args.merged \
            else 'data/processed/clean.csv'
manifest_file = 'data/processed/data_manifest_merged.json' if args.merged \
                else 'data/processed/data_manifest.json'
model_out_path = 'models/lr_merged.joblib' if args.merged else 'models/lr.joblib'

# Load
df = pd.read_csv(data_file)
symptom_cols = [c for c in df.columns if c != 'Disease']
X = df[symptom_cols].values.astype(np.float32)
y = df['Disease'].values
manifest = json.load(open(manifest_file))

# Age bands and sex encoding (use defaults for the training baseline)
# The full feature vector (139) is built in export_onnx.py
# For training: use the 131-symptom binary matrix + placeholder age/sex
# or add them here if the dataset contains them
# Currently: the itachi9604 dataset has only symptoms and disease
# So train on 131 features only, export 139-feature model for inference
# NOTE: age_band (7) and sex (1) features are zero-padded during training
# and the browser will fill them with real values
n_sym = X.shape[1]
n_age_bands = 7
n_total = n_sym + n_age_bands + 1  # 139
X_full = np.zeros((len(X), n_total), dtype=np.float32)
X_full[:, :n_sym] = X  # symptom columns; age/sex = 0 in training

# Split
from sklearn.model_selection import train_test_split
Xtr, Xte, ytr, yte = train_test_split(X_full, y, test_size=0.2, random_state=42, stratify=y)

# CV scheme
min_class = min(pd.Series(y).value_counts())
n_splits = min(5, min_class)
cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=10, random_state=42)

models = {
    'LogisticRegression': LogisticRegression(max_iter=2000, C=1.0, random_state=42, n_jobs=-1),
    'RandomForest': RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1),
    'GradientBoosting': GradientBoostingClassifier(n_estimators=100, random_state=42),
}

results = {}
for name, clf in models.items():
    cv_res = cross_validate(clf, X_full, y, cv=cv,
                            scoring=['accuracy', 'f1_macro', 'precision_macro', 'recall_macro'],
                            n_jobs=-1)
    clf.fit(Xtr, ytr)
    proba = clf.predict_proba(Xte)
    top3 = top_k_accuracy_score(yte, proba, k=3, labels=clf.classes_)
    # NOTE: use clf.predict() for the point estimate, not proba.argmax(1) --
    # argmax gives integer class *indices*, and comparing those to the string
    # labels in yte would always be False.
    sk_pred = clf.predict(Xte)
    n = len(yte); k = int((sk_pred == yte).sum())
    lo, hi = proportion_confint(k, n, method='wilson')
    results[name] = {
        'top1_mean': cv_res['test_accuracy'].mean(),
        'top1_std': cv_res['test_accuracy'].std(),
        'top1_ci_lo': lo, 'top1_ci_hi': hi,
        'top3': top3,
        'f1_macro': cv_res['test_f1_macro'].mean(),
        'precision_macro': cv_res['test_precision_macro'].mean(),
        'recall_macro': cv_res['test_recall_macro'].mean(),
    }
    print(f"{name}: {results[name]['top1_mean']:.4f} ± {results[name]['top1_std']:.4f}")

# Save primary model
lr = models['LogisticRegression']
lr.fit(Xtr, ytr)  # refit on full train set for export
joblib.dump({'model': lr, 'feature_means': X_full.mean(axis=0),
             'symptom_cols': symptom_cols, 'classes': list(lr.classes_)},
            model_out_path)

# Save metrics
rows_before = manifest.get('rows_before', manifest.get('rows_total_before_dedup'))
rows_after = manifest.get('rows_after', manifest.get('rows_after_dedup'))
header = (f"# ArogyaAI Model Metrics\n"
          f"Date: {date.today()}\n"
          f"Data: {data_file}\n"
          f"De-duplication: {rows_before} → {rows_after} rows\n"
          f"CV: RepeatedStratifiedKFold(n_splits={n_splits}, n_repeats=10)\n\n")
table = "| Model | Top-1 mean±sd | 95% CI | Top-3 | F1 macro |\n|---|---|---|---|---|\n"
for name, r in results.items():
    table += f"| {name} | {r['top1_mean']:.4f}±{r['top1_std']:.4f} | [{r['top1_ci_lo']:.3f},{r['top1_ci_hi']:.3f}] | {r['top3']:.4f} | {r['f1_macro']:.4f} |\n"
print("\n" + header + table)
# Only the original (non-merged) run writes its own results/metrics.md --
# that file is part of the untouched original path. The merged run's
# per-model numbers are captured via stdout redirection (Step 5) instead,
# so this script never overwrites metrics.md when comparing the two.
if not args.merged:
    open('results/metrics.md', 'w').write(header + table)
    print("\nSaved to results/metrics.md")
else:
    print("\n(merged run: not writing results/metrics.md, see stdout capture)")
