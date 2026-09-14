import joblib, json, gzip, numpy as np
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import onnxruntime as ort

# Load
saved = joblib.load('models/lr.joblib')
clf = saved['model']
means = saved['feature_means']
symptom_cols = saved['symptom_cols']
classes = saved['classes']

N_FEATURES = 139  # 131 symptoms + 7 age bands + 1 sex

# Export
onx = convert_sklearn(
    clf,
    initial_types=[("float_input", FloatTensorType([None, N_FEATURES]))],
    options={type(clf): {"zipmap": False}},   # MANDATORY — see AD-3
    target_opset=12,
)
blob = onx.SerializeToString()
open('web/models/arogya.onnx', 'wb').write(blob)
open('web/models/arogya.onnx.gz', 'wb').write(gzip.compress(blob, 9))
print(f"ONNX raw: {len(blob)/1e3:.1f} KB, gzipped: {len(gzip.compress(blob,9))/1e3:.1f} KB")

# Verify
sess = ort.InferenceSession('web/models/arogya.onnx', providers=['CPUExecutionProvider'])

# Load test set
import pandas as pd
from sklearn.model_selection import train_test_split
df = pd.read_csv('data/processed/clean.csv')
sym = [c for c in df.columns if c != 'Disease']
X = df[sym].values.astype(np.float32)
y = df['Disease'].values
X_full = np.zeros((len(X), N_FEATURES), dtype=np.float32)
X_full[:, :len(sym)] = X
_, Xte, _, yte = train_test_split(X_full, y, test_size=0.2, random_state=42, stratify=y)

# Check 1: label parity
sk_labels = clf.predict(Xte)
onnx_out = sess.run(None, {'float_input': Xte})
onnx_labels = onnx_out[0]
mismatches = int((sk_labels != onnx_labels).sum())
print(f"[{'PASS' if mismatches == 0 else 'FAIL'}] Label parity: {mismatches} mismatches / {len(yte)}")

# Check 2: probability parity
sk_proba = clf.predict_proba(Xte)
onnx_proba = onnx_out[1]
max_diff = float(np.abs(sk_proba - onnx_proba).max())
print(f"[{'PASS' if max_diff < 1e-4 else 'FAIL'}] Probability parity: max diff {max_diff:.2e}")

# Write attributions.json (AD-5)
# IMPORTANT: means must be for the FULL 139-feature vector
full_means = means.tolist()  # already 139-length from train.py
attr = {
    "coef": clf.coef_.astype(np.float32).tolist(),
    "mean": full_means,
    "classes": classes,
    "symptoms": symptom_cols,
    "age_bands": ["0-1","1-5","5-12","12-18","18-40","40-60","60+"],
    "sex_encoding": {"M": 0.0, "F": 1.0, "O": 0.5}
}
json.dump(attr, open('web/data/attributions.json', 'w'))
print(f"attributions.json: {len(classes)} classes, {len(symptom_cols)} symptoms")
