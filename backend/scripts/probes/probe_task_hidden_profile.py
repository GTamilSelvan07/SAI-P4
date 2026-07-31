"""
Probe: task hidden-profile structural invariants.

Validates every JSON in backend/tasks/ matches the redesigned shape:
- 3 shared facts (always)
- 6 unique facts per side (3 for practice_task)
- archetype field present and one of {pro_split, con_split, twisty} (except practice)
- p1_persona and p2_persona are present
- correct_answer is one of the candidate ids
- anchor_option is one of the candidate ids and != correct_answer
- p1 and p2 unique facts have no exact-string overlap
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

VALID_ARCHETYPES = {"pro_split", "con_split", "twisty"}
TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"
PRACTICE_ID = "practice_task"


def validate_task(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        data = json.loads(path.read_text())
    except Exception as e:
        return [f"{path.name}: invalid JSON ({e})"]

    name = path.name
    is_practice = data.get("id") == PRACTICE_ID

    candidate_ids = {c["id"] for c in data.get("candidates", []) if isinstance(c, dict) and "id" in c}
    if not candidate_ids:
        errors.append(f"{name}: no candidates with ids")

    correct = data.get("correct_answer")
    if correct not in candidate_ids:
        errors.append(f"{name}: correct_answer {correct!r} not in candidate ids {candidate_ids}")

    anchor = data.get("anchor_option")
    if anchor not in candidate_ids:
        errors.append(f"{name}: anchor_option {anchor!r} not in candidate ids {candidate_ids}")
    if anchor == correct:
        errors.append(f"{name}: anchor_option must differ from correct_answer")

    archetype = data.get("archetype")
    if not is_practice and archetype not in VALID_ARCHETYPES:
        errors.append(f"{name}: archetype must be one of {VALID_ARCHETYPES}, got {archetype!r}")

    for key in ("p1_persona", "p2_persona"):
        if not isinstance(data.get(key), str) or not data.get(key, "").strip():
            errors.append(f"{name}: {key} must be a non-empty string")

    shared = data.get("shared_info", [])
    p1 = data.get("p1_unique_info", [])
    p2 = data.get("p2_unique_info", [])

    if not isinstance(shared, list) or not all(isinstance(x, str) for x in shared):
        errors.append(f"{name}: shared_info must be list[str]")
    if not isinstance(p1, list) or not all(isinstance(x, str) for x in p1):
        errors.append(f"{name}: p1_unique_info must be list[str]")
    if not isinstance(p2, list) or not all(isinstance(x, str) for x in p2):
        errors.append(f"{name}: p2_unique_info must be list[str]")

    if is_practice:
        if len(shared) != 3:
            errors.append(f"{name}: practice expects 3 shared facts, got {len(shared)}")
        if len(p1) != 3:
            errors.append(f"{name}: practice expects 3 p1_unique facts, got {len(p1)}")
        if len(p2) != 3:
            errors.append(f"{name}: practice expects 3 p2_unique facts, got {len(p2)}")
    else:
        if len(shared) != 3:
            errors.append(f"{name}: expected 3 shared facts (post-redesign), got {len(shared)}")
        if len(p1) != 6:
            errors.append(f"{name}: expected 6 p1_unique facts (post-redesign), got {len(p1)}")
        if len(p2) != 6:
            errors.append(f"{name}: expected 6 p2_unique facts (post-redesign), got {len(p2)}")

    overlap = set(p1) & set(p2)
    if overlap:
        errors.append(f"{name}: {len(overlap)} unique facts appear on both sides — must be exclusive")

    return errors


def main() -> int:
    if not TASKS_DIR.exists():
        print(f"FAIL: tasks directory not found: {TASKS_DIR}")
        return 1
    json_files = sorted(TASKS_DIR.glob("*.json"))
    if not json_files:
        print(f"FAIL: no task JSON files in {TASKS_DIR}")
        return 1

    all_errors: list[str] = []
    for p in json_files:
        all_errors.extend(validate_task(p))

    if all_errors:
        print(f"FAIL: {len(all_errors)} invariant violation(s) across {len(json_files)} task file(s):")
        for e in all_errors:
            print(f"  - {e}")
        return 1

    print(f"PASS: {len(json_files)} task files satisfy hidden-profile invariants")
    return 0


if __name__ == "__main__":
    sys.exit(main())
