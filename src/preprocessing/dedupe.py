"""Phase 1: load the raw Kaggle CSV, normalise symptom names, pivot to a
binary matrix, drop exact duplicates, and write clean.csv + the manifest."""

import csv
import hashlib
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_PATH = ROOT / "data/raw/dataset.csv"
CLEAN_PATH = ROOT / "data/processed/clean.csv"
MANIFEST_PATH = ROOT / "data/processed/data_manifest.json"
SYMPTOMS_JSON_PATH = ROOT / "web/data/symptoms.json"

SYMPTOM_COLUMNS = [f"Symptom_{i}" for i in range(1, 18)]


def normalize_symptom(raw: str) -> str:
    s = raw.strip().lower()
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"_+", "_", s)
    return s


def load_raw(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_symptom_sets(rows: list[dict]) -> tuple[list[tuple[str, set]], set]:
    parsed = []
    symptom_set = set()
    for row in rows:
        disease = row["Disease"].strip()
        symptoms = {
            normalize_symptom(row[col])
            for col in SYMPTOM_COLUMNS
            if row.get(col) and row[col].strip()
        }
        symptom_set.update(symptoms)
        parsed.append((disease, symptoms))
    return parsed, symptom_set


def to_binary_rows(parsed: list[tuple[str, set]], ordered_symptoms: list[str]) -> list[dict]:
    return [
        {"Disease": disease, **{s: int(s in symptoms) for s in ordered_symptoms}}
        for disease, symptoms in parsed
    ]


def dedupe_rows(matrix: list[dict], ordered_symptoms: list[str]) -> list[dict]:
    seen = set()
    deduped = []
    for row in matrix:
        key = (row["Disease"], *(row[s] for s in ordered_symptoms))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def run(
    raw_path: Path = RAW_PATH,
    clean_path: Path = CLEAN_PATH,
    manifest_path: Path = MANIFEST_PATH,
    symptoms_json_path: Path = SYMPTOMS_JSON_PATH,
) -> dict:
    rows = load_raw(raw_path)
    rows_before = len(rows)

    parsed, symptom_set = build_symptom_sets(rows)
    ordered_symptoms = sorted(symptom_set)

    matrix = to_binary_rows(parsed, ordered_symptoms)
    deduped = dedupe_rows(matrix, ordered_symptoms)
    rows_after = len(deduped)
    duplicates_removed = rows_before - rows_after

    class_counts: dict = {}
    for row in deduped:
        class_counts[row["Disease"]] = class_counts.get(row["Disease"], 0) + 1
    class_counts = dict(sorted(class_counts.items()))

    clean_path.parent.mkdir(parents=True, exist_ok=True)
    with clean_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Disease", *ordered_symptoms])
        writer.writeheader()
        writer.writerows(deduped)

    manifest = {
        "source": "data/raw/dataset.csv",
        "generated": date.today().isoformat(),
        "sha256": sha256_of(raw_path),
        "rows_before": rows_before,
        "rows_after": rows_after,
        "duplicates_removed": duplicates_removed,
        "n_symptoms": len(ordered_symptoms),
        "n_diseases": len(class_counts),
        "class_counts": class_counts,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    symptoms_json_path.parent.mkdir(parents=True, exist_ok=True)
    with symptoms_json_path.open("w", encoding="utf-8") as f:
        json.dump(ordered_symptoms, f, indent=2)
        f.write("\n")

    print(
        f"{rows_before} -> {rows_after} rows ({duplicates_removed} duplicates removed), "
        f"{len(ordered_symptoms)} symptoms, {len(class_counts)} diseases"
    )
    return manifest


if __name__ == "__main__":
    run()
