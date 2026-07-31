"""
Per-session randomization helpers for C3 (anchoring) and C4 (amplification).

The BIBD counterbalancing scheme that gave this module its name was removed
in commit `fd8c2cc` when the platform moved to single-run sessions (one
condition × one task per session). Only the two reproducible-seed helpers
below remain — they're still used to randomize anchor direction (C3) and
amplification target (C4) per session.
"""
import random
from typing import Optional

from app.config import C3_ANCHORING_ASSIGNMENT, TASKS_DIR


def assign_anchoring_direction(group_number: int) -> str:
    """For C3, return the configured anchor assignment label."""
    return C3_ANCHORING_ASSIGNMENT


def assign_amplification_target(group_number: int) -> str:
    """For C4, randomly assign which participant gets amplified (seeded per group)."""
    rng = random.Random(group_number * 7 + 3)
    return rng.choice(["P1", "P2"])


def resolve_c3_anchor_option(task_id: str, anchor_option: Optional[str]) -> Optional[str]:
    """Resolve C3's counterbalance label to the concrete candidate id.

    Session metadata stores the experimental assignment as "correct" or
    "incorrect" for analysis. The live facilitator needs the concrete option
    id (A/B/C) to fill the ``{anchor_option}`` prompt variable, so this
    resolves the label against the task definition at the boundary.
    """
    if anchor_option is None:
        return None
    if anchor_option in {"A", "B", "C"}:
        return anchor_option
    if anchor_option not in {"correct", "incorrect"}:
        return anchor_option

    from app.tasks import Task, task_registry

    task = task_registry.get(task_id)
    if task is None:
        task_path = TASKS_DIR / f"{task_id}.json"
        if task_path.exists():
            try:
                task = Task.model_validate_json(task_path.read_text("utf-8"))
            except Exception:
                task = None
    if task is None:
        return anchor_option
    if anchor_option == "correct":
        return task.correct_answer
    # "incorrect" → prefer the task's designated anchor lure, else any non-correct candidate
    if task.anchor_option != task.correct_answer:
        return task.anchor_option
    for candidate in task.candidates:
        if candidate.id != task.correct_answer:
            return candidate.id
    return task.anchor_option
