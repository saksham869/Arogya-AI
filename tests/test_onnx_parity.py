import joblib
import numpy as np
import onnxruntime as ort
import pandas as pd
from sklearn.model_selection import train_test_split

N_FEATURES = 139


def _load_test_split():
    df = pd.read_csv('data/processed/clean.csv')
    sym = [c for c in df.columns if c != 'Disease']
    X = df[sym].values.astype(np.float32)
    y = df['Disease'].values
    X_full = np.zeros((len(X), N_FEATURES), dtype=np.float32)
    X_full[:, :len(sym)] = X
    _, Xte, _, yte = train_test_split(X_full, y, test_size=0.2, random_state=42, stratify=y)
    return Xte, yte


def test_onnx_label_parity():
    saved = joblib.load('models/lr.joblib')
    clf = saved['model']
    sess = ort.InferenceSession('web/models/arogya.onnx', providers=['CPUExecutionProvider'])
    Xte, _ = _load_test_split()

    sk_labels = clf.predict(Xte)
    onnx_labels = sess.run(None, {'float_input': Xte})[0]
    mismatches = int((sk_labels != onnx_labels).sum())
    assert mismatches == 0, f"{mismatches} label mismatches / {len(sk_labels)}"


def test_onnx_probability_parity():
    saved = joblib.load('models/lr.joblib')
    clf = saved['model']
    sess = ort.InferenceSession('web/models/arogya.onnx', providers=['CPUExecutionProvider'])
    Xte, _ = _load_test_split()

    sk_proba = clf.predict_proba(Xte)
    onnx_proba = sess.run(None, {'float_input': Xte})[1]
    max_diff = float(np.abs(sk_proba - onnx_proba).max())
    assert max_diff < 1e-4, f"probability max diff {max_diff:.2e}"
