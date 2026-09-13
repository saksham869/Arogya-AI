import csv
import json
from pathlib import Path

from src.preprocessing import dedupe

ROOT = Path(__file__).resolve().parents[1]


def test_no_duplicates_and_manifest_consistency(tmp_path):
    clean_path = tmp_path / "clean.csv"
    manifest_path = tmp_path / "data_manifest.json"
    symptoms_path = tmp_path / "symptoms.json"

    manifest = dedupe.run(
        raw_path=ROOT / "data/raw/dataset.csv",
        clean_path=clean_path,
        manifest_path=manifest_path,
        symptoms_json_path=symptoms_path,
    )

    with clean_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    seen = set()
    for row in rows:
        key = tuple(row.items())
        assert key not in seen, f"duplicate row survived dedupe: {row}"
        seen.add(key)

    assert len(rows) == manifest["rows_after"]
    assert manifest["rows_before"] - manifest["duplicates_removed"] == manifest["rows_after"]
    assert sum(manifest["class_counts"].values()) == manifest["rows_after"]
    assert len(manifest["class_counts"]) == manifest["n_diseases"]
    assert len(rows[0]) - 1 == manifest["n_symptoms"]

    with symptoms_path.open(encoding="utf-8") as f:
        symptoms = json.load(f)
    assert len(symptoms) == manifest["n_symptoms"]
    assert symptoms == sorted(symptoms)
    assert len(symptoms) == len(set(symptoms))


def test_empty_symptom_cells_ignored(tmp_path):
    raw_path = tmp_path / "dataset.csv"
    raw_path.write_text(
        "Disease,Symptom_1,Symptom_2,Symptom_3\n"
        "Flu,fever, cough,\n"
        "Flu, cough,fever,\n"  # same set, different column order -> should collapse
        "Cold,cough,,\n",
        encoding="utf-8",
    )

    manifest = dedupe.run(
        raw_path=raw_path,
        clean_path=tmp_path / "clean.csv",
        manifest_path=tmp_path / "manifest.json",
        symptoms_json_path=tmp_path / "symptoms.json",
    )

    assert manifest["rows_before"] == 3
    assert manifest["rows_after"] == 2
    assert manifest["duplicates_removed"] == 1
    assert manifest["n_symptoms"] == 2
    assert manifest["n_diseases"] == 2


def test_normalizes_known_quirky_symptom_strings(tmp_path):
    raw_path = tmp_path / "dataset.csv"
    raw_path.write_text(
        "Disease,Symptom_1,Symptom_2\n"
        "Skin issue, dischromic _patches,\n"
        "Urinary issue, spotting_ urination,\n",
        encoding="utf-8",
    )

    manifest = dedupe.run(
        raw_path=raw_path,
        clean_path=tmp_path / "clean.csv",
        manifest_path=tmp_path / "manifest.json",
        symptoms_json_path=tmp_path / "symptoms.json",
    )

    with (tmp_path / "symptoms.json").open() as f:
        symptoms = json.load(f)

    assert "dischromic_patches" in symptoms
    assert "spotting_urination" in symptoms
    assert not any("__" in s for s in symptoms)
