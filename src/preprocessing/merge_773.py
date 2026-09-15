"""Opt-in pipeline path: merge extra rows for the existing 41 diseases in
from the dhivyeshrk "Diseases and Symptoms" 773-disease Kaggle dataset.

This does NOT touch data/processed/clean.csv or data_manifest.json -- the
original 304-row path (dedupe.py) is untouched and still the default. This
script writes a separate clean_merged.csv / data_manifest_merged.json that
train.py can opt into via --merged.

Two judgment calls were made here after inspecting both datasets, both
explicitly approved by the user rather than assumed silently:

1. DISEASE NAME ALIASING. Only 16 of the 41 diseases match the 773-set's
   disease column by exact name after normalization. The other 25 use
   different wording for the same condition (dengue -> "dengue fever"),
   umbrella terms that need unioning subtypes (arthritis -> rheumatoid +
   septic + reactive + juvenile + hip arthritis), or -- for Hepatitis A/B/
   C/D/E specifically -- collapse onto the 773-set's single generic "viral
   hepatitis" bucket, meaning rows that are actually e.g. Hepatitis C get
   merged into training data for all five of the 41-set's Hepatitis
   classes indiscriminately. That is real label noise, disclosed and
   approved rather than hidden. 2 diseases (Chronic cholestasis,
   Hyperthyroidism) have no candidate at all in the 773-set under any
   reasonable reading, including fuzzy name matching (difflib against all
   773 disease names, cutoff=0.3) -- the closest hits were "cholecystitis"
   (gallbladder inflammation -- a different organ-system diagnosis from
   cholestasis, a bile-flow pattern) and "hypothyroidism"/"thyroid
   disease" (wrong direction / too generic). Both rejected as worse than
   the Hepatitis collapse above, not used. These 2 diseases get zero
   extra rows.

2. SYMPTOM SCHEMA GAP. The 773-set's 377 symptom columns are a genuinely
   different, finer-grained vocabulary than the 41-set's 131 columns --
   only 22 column names match after normalization (strip/lower/space-to-
   underscore). The other 109 of the 41-set's columns are always 0 for
   every row sourced from the 773-set, because that information plain
   doesn't exist under a matching name in the source data. ~20% of the
   773-set rows for matched diseases have none of those 22 symptoms set,
   producing an all-zero symptom vector paired with a real disease label.
   The first run of this script kept those rows per explicit instruction;
   it measurably hurt the model (LR top-1 accuracy 1.00 -> 0.70, and the
   confidence interval got *wider* despite more data) by reintroducing
   cross-disease vector collisions the original 304-row set never had.
   Dropping them is now the default (drop_all_zero=True); pass
   --keep-all-zero on the CLI to reproduce the original run.
"""

import csv
import hashlib
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_41_PATH = ROOT / "data/raw/dataset.csv"
RAW_773_PATH = ROOT / "data/raw/dataset_773.csv"
CLEAN_41_PATH = ROOT / "data/processed/clean.csv"
CLEAN_MERGED_PATH = ROOT / "data/processed/clean_merged.csv"
MANIFEST_MERGED_PATH = ROOT / "data/processed/data_manifest_merged.json"

# 41-set disease name (Title Case, exact match to clean.csv's Disease
# column) -> list of 773-set disease names (lowercase, exact match to its
# `diseases` column) whose rows should be pulled in as extra training
# examples for that class. Diseases not listed here rely on exact-name
# matching alone (see EXACT_MATCH_ONLY below); diseases listed with an
# empty list have no usable candidate and are documented as unmapped.
DISEASE_ALIAS_MAP: dict[str, list[str]] = {
    "(vertigo) Paroymsal  Positional Vertigo": ["benign paroxysmal positional vertical (bppv)"],
    "AIDS": ["human immunodeficiency virus infection (hiv)"],  # stage mismatch, disclosed
    "Alcoholic hepatitis": ["alcoholic liver disease"],  # broader category, disclosed
    "Arthritis": [
        "rheumatoid arthritis", "septic arthritis", "reactive arthritis",
        "juvenile rheumatoid arthritis", "arthritis of the hip",
    ],
    "Bronchial Asthma": ["asthma"],
    "Cervical spondylosis": ["spondylosis"],  # drops cervical-specificity, disclosed
    "Chronic cholestasis": [],  # no candidate found -- stays unmapped
    "Dengue": ["dengue fever"],
    "Dimorphic hemmorhoids(piles)": ["hemorrhoids"],
    "Fungal infection": ["fungal infection of the hair", "fungal infection of the skin"],
    "Gastroenteritis": ["infectious gastroenteritis", "noninfectious gastroenteritis"],
    "GERD": ["gastroesophageal reflux disease (gerd)"],
    "Hepatitis A": ["viral hepatitis"],  # generic bucket shared by all 5 hep types, disclosed
    "Hepatitis B": ["viral hepatitis"],
    "Hepatitis C": ["viral hepatitis"],
    "Hepatitis D": ["viral hepatitis"],
    "Hepatitis E": ["viral hepatitis"],
    "Hypertension": ["high blood pressure"],
    "Hyperthyroidism": [],  # no candidate found -- stays unmapped
    "Jaundice": ["neonatal jaundice"],  # age-scoped subtype, disclosed
    "Osteoarthristis": ["osteoarthritis"],  # corrects the 41-set's own typo
    "Paralysis (brain hemorrhage)": [
        "intracerebral hemorrhage", "intracranial hemorrhage",
        "subarachnoid hemorrhage", "subdural hemorrhage",
    ],
    "Peptic ulcer diseae": ["gastroduodenal ulcer"],
    "Typhoid": ["typhoid fever"],
}

# The 16 diseases whose normalized name matches the 773-set's `diseases`
# column exactly -- no aliasing needed.
EXACT_MATCH_ONLY = [
    "Acne", "Allergy", "Common Cold", "Diabetes", "Drug Reaction",
    "Heart attack", "Hypoglycemia", "Hypothyroidism", "Impetigo", "Malaria",
    "Migraine", "Pneumonia", "Psoriasis", "Tuberculosis",
    "Urinary tract infection", "Varicose veins",
]


def normalize_symptom(raw: str) -> str:
    s = raw.strip().lower()
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"_+", "_", s)
    return s


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_773_structure(fieldnames: list[str]) -> str:
    """The 773-set ships as a single disease column + binary symptom
    columns already (confirmed by inspection: 'diseases' + 377 int64
    columns). Detect that vs. a wide Symptom_1..Symptom_N format so this
    script doesn't silently mis-parse a differently-shaped CSV if the
    source file ever changes."""
    wide_cols = [c for c in fieldnames if re.match(r"^Symptom_\d+$", c or "")]
    if wide_cols:
        return "wide"
    return "binary"


def load_41_clean() -> tuple[list[dict], list[str]]:
    with CLEAN_41_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        symptom_cols = [c for c in reader.fieldnames if c != "Disease"]
        rows = list(reader)
    return rows, symptom_cols


def load_773_binary_rows(symptom_cols_41: list[str]) -> tuple[list[dict], int]:
    """Returns (rows projected onto the 41-set's 131-column schema, rows_before_filter).
    Each output row is {"Disease": <41-set Title Case name>, **{sym: 0/1}}.
    """
    with RAW_773_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        structure = detect_773_structure(fieldnames)
        if structure != "binary":
            raise NotImplementedError(
                f"data/raw/dataset_773.csv is in '{structure}' format, not the "
                "expected single-disease-column + binary-symptom-columns format "
                "this script was written for. Inspect the file and extend "
                "load_773_binary_rows() before proceeding."
            )
        disease_col = fieldnames[0]
        raw_symptom_cols = [c for c in fieldnames if c != disease_col]
        # Map: normalized-name -> actual 773 column name, for the columns
        # that exist in both schemas.
        norm_to_773col = {normalize_symptom(c): c for c in raw_symptom_cols}
        overlap_cols_41 = [s for s in symptom_cols_41 if s in norm_to_773col]

        # Build the reverse lookup: normalized 773 disease name -> the
        # 41-set Title Case name(s) it should be merged into.
        alias_lookup: dict[str, str] = {}
        for disease_41, aliases in DISEASE_ALIAS_MAP.items():
            for alias in aliases:
                alias_lookup[alias] = disease_41
        for disease_41 in EXACT_MATCH_ONLY:
            alias_lookup[disease_41.strip().lower()] = disease_41

        out_rows = []
        rows_before_filter = 0
        for row in reader:
            rows_before_filter += 1
            d773 = row[disease_col].strip().lower()
            disease_41 = alias_lookup.get(d773)
            if disease_41 is None:
                continue
            out_row = {"Disease": disease_41}
            for s in symptom_cols_41:
                if s in overlap_cols_41:
                    val = row.get(norm_to_773col[s], "0")
                    out_row[s] = 1 if str(val).strip() in ("1", "1.0", "True", "true") else 0
                else:
                    out_row[s] = 0
            out_rows.append(out_row)

    return out_rows, rows_before_filter


def dedupe_rows(rows: list[dict], symptom_cols: list[str]) -> list[dict]:
    seen = set()
    deduped = []
    for row in rows:
        key = (row["Disease"], *(int(row[s]) for s in symptom_cols))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def run(drop_all_zero: bool = True) -> dict:
    rows_41, symptom_cols = load_41_clean()
    rows_from_41 = len(rows_41)

    rows_773_projected, rows_before_filter_773 = load_773_binary_rows(symptom_cols)
    rows_from_773_raw = len(rows_773_projected)

    # All-zero-symptom-vector rows sourced from the 773 set: none of that
    # row's real symptoms happened to have a same-named column in the
    # 41-set's 131-symptom vocabulary. The first run of this script kept
    # them per explicit instruction; that measurably hurt the model (LR
    # top-1 dropped from 1.00 to 0.70, CI got *wider* not narrower) because
    # it broke the original dataset's zero-symptom-vector-collision
    # property -- many different diseases ended up sharing the identical
    # all-zero vector, which is pure label noise, not a harder-but-real
    # classification problem. Dropping them is now the default; pass
    # drop_all_zero=False to reproduce the original (worse) run.
    all_zero_773_rows = sum(
        1 for r in rows_773_projected if all(r[s] == 0 for s in symptom_cols)
    )
    if drop_all_zero:
        rows_773_projected = [
            r for r in rows_773_projected if any(r[s] == 1 for s in symptom_cols)
        ]
    rows_from_773 = len(rows_773_projected)

    all_rows = [{"Disease": r["Disease"], **{s: int(r[s]) for s in symptom_cols}} for r in rows_41]
    all_rows += rows_773_projected

    rows_total_before_dedup = len(all_rows)
    deduped = dedupe_rows(all_rows, symptom_cols)
    rows_after_dedup = len(deduped)
    duplicates_removed = rows_total_before_dedup - rows_after_dedup

    class_counts: dict = {}
    for row in deduped:
        class_counts[row["Disease"]] = class_counts.get(row["Disease"], 0) + 1
    class_counts = dict(sorted(class_counts.items()))

    CLEAN_MERGED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CLEAN_MERGED_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Disease", *symptom_cols])
        writer.writeheader()
        writer.writerows(deduped)

    unmapped = [d for d, aliases in DISEASE_ALIAS_MAP.items() if not aliases]

    manifest = {
        "sources": [
            "data/raw/dataset.csv",
            "data/raw/dataset_773.csv",
        ],
        "sha256_41": sha256_of(RAW_41_PATH),
        "sha256_773": sha256_of(RAW_773_PATH),
        "generated": date.today().isoformat(),
        "rows_from_41_before_dedup": rows_from_41,
        "rows_from_773_before_dedup": rows_from_773,
        "rows_from_773_raw_candidates": rows_from_773_raw,
        "rows_from_773_all_zero_dropped": all_zero_773_rows if drop_all_zero else 0,
        "drop_all_zero_rows": drop_all_zero,
        "rows_total_before_dedup": rows_total_before_dedup,
        "rows_after_dedup": rows_after_dedup,
        "duplicates_removed": duplicates_removed,
        "n_symptoms": len(symptom_cols),
        "n_diseases": len(class_counts),
        "class_counts": class_counts,
        "note": (
            "Only rows whose disease label appears (directly or via the "
            "disclosed DISEASE_ALIAS_MAP in merge_773.py) in the original "
            "41-disease set were retained from the 773-disease source. "
            "Symptom columns not present by name in the 773-set are 0 for "
            "every 773-sourced row (only 22 of 131 symptom columns overlap "
            "by name). Rows left entirely zero under that 22-column overlap "
            f"are {'dropped' if drop_all_zero else 'kept'} "
            f"({all_zero_773_rows} such rows found among the 773-source "
            "candidates) -- keeping them was tried first and measurably "
            "hurt the model (LR top-1 1.00 -> 0.70), so dropping is now the "
            "default. 2 diseases (Chronic cholestasis, Hyperthyroidism) "
            "had no usable candidate in the 773-set even under fuzzy "
            "name matching (difflib) and received zero extra rows."
        ),
        "disease_alias_map": DISEASE_ALIAS_MAP,
        "unmapped_diseases": unmapped,
    }
    MANIFEST_MERGED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_MERGED_PATH.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"41-disease source: {rows_from_41} rows")
    print(f"773-disease source (41 overlapping diseases only): {rows_from_773_raw} candidate rows")
    print(f"  ({all_zero_773_rows} of which are all-zero symptom vectors, "
          f"{'dropped' if drop_all_zero else 'kept'} this run)")
    print(f"  {rows_from_773} rows carried forward into the merge")
    print(f"Combined before dedup: {rows_total_before_dedup} rows")
    print(f"After dedup: {rows_after_dedup} rows")
    print(f"Symptoms: {len(symptom_cols)}")
    print(f"Diseases: {len(class_counts)} (unmapped, zero extra rows: {unmapped})")
    with open(ROOT / "data/processed/data_manifest.json") as f:
        original_class_counts = json.load(f)["class_counts"]
    print(f"Min class count: {min(class_counts.values())} (was {min(original_class_counts.values())} in the original 304-row set)")
    return manifest


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--keep-all-zero', action='store_true',
                        help='Reproduce the first run: keep rows with no '
                             'symptom in the 22-column name overlap. '
                             'Default is to drop them (see module docstring).')
    args = parser.parse_args()
    run(drop_all_zero=not args.keep_all_zero)
