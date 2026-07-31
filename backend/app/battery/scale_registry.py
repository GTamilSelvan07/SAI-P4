"""
Backend-side scale manifest for the questionnaire battery.

This file is the source of truth for *which scales appear in which phase*
and *which can be randomised*. Item content (item text, anchors, response
types) lives in `frontend/src/components/Battery/scaleRegistry.ts` — that's
the rendering registry. Both files share `REGISTRY_VERSION` and the scale
ids must stay in sync.

Why split:
- Backend needs the manifest so `/progress` can compute and persist a
  random scale order without trusting the client.
- Frontend needs the full item content to render scales.
- Keeping item wording out of Python means clinicians/researchers can audit
  one TS file rather than reading both.

See `docs/superpowers/specs/2026-05-09-questionnaire-battery-integration-design.md` §3.1, §4.3.
"""
import hashlib
import logging
import random
from typing import Iterable, Optional

log = logging.getLogger(__name__)


# Bumped when scale set or ordering rules change. Frontend must match.
REGISTRY_VERSION = "2026-05-09-v0.2"


# Scales delivered once per group, before the first session. Section B in
# `research/questionnaire-battery.md`.
INTAKE_SCALES: tuple[str, ...] = (
    "tipi",
    "ncs6",
    "propensity",
    "sam_pre",
    "pre_pref",
)


# Post-task scales for C0 (no-AI baseline). Subset of the AI battery —
# AI-specific scales are skipped because Alex is absent.
POSTTASK_SCALES_C0: tuple[str, ...] = (
    "jehn",
    "satisfaction",
    "mutual",
    "nasa_tlx",
    "sam_post",
    "engagement",
)


# Post-task scales for C1–C5. `manipulation_check` is pinned to the last
# position (see PINNED_LAST) so the open-suspicion probe never fires after
# a cued probe — that ordering would bias responses.
POSTTASK_SCALES_AI: tuple[str, ...] = (
    "jian",
    "schaefer",
    "godspeed",
    "sassi",
    "jehn",
    "satisfaction",
    "mutual",
    "nasa_tlx",
    "sam_post",
    "engagement",
    "manipulation_check",
)


# Post-debrief — fires on the last session of a group when the researcher
# clicks "End Group".
DEBRIEF_SCALES: tuple[str, ...] = (
    "debrief_manipulation",
)


# Scales NOT eligible for random shuffling. They keep their natural
# (relative) position after the shuffle is applied to the rest.
PINNED_LAST: frozenset[str] = frozenset({"manipulation_check"})


# Conditions whose post-task path uses the AI battery (vs C0's reduced set).
AI_CONDITIONS: frozenset[str] = frozenset({"C1", "C2", "C3", "C4", "C5"})


def scales_for_phase(phase: str, condition: Optional[str] = None) -> tuple[str, ...]:
    """Return the unfiltered scale-id list for (phase, condition).

    Raises ValueError on unknown phase or condition. `condition` is required
    for posttask; ignored for intake and debrief.
    """
    if phase == "intake":
        return INTAKE_SCALES
    if phase == "debrief":
        return DEBRIEF_SCALES
    if phase == "posttask":
        if condition is None:
            raise ValueError("condition is required for phase='posttask'")
        if condition == "C0":
            return POSTTASK_SCALES_C0
        if condition in AI_CONDITIONS:
            return POSTTASK_SCALES_AI
        raise ValueError(f"unknown condition: {condition!r}")
    raise ValueError(f"unknown phase: {phase!r}")


def randomise_order(scale_ids: Iterable[str], seed: int) -> list[str]:
    """Permute `scale_ids`, keeping PINNED_LAST scales in last position.

    Deterministic for a given seed — the same seed always yields the same
    order, which is what `battery_orders.seed` records for analysis
    reproducibility.
    """
    ids = list(scale_ids)
    pinned = [s for s in ids if s in PINNED_LAST]
    free = [s for s in ids if s not in PINNED_LAST]
    rng = random.Random(seed)
    rng.shuffle(free)
    # Pinned scales keep their declaration order; only manipulation_check
    # exists today, but if more pinned-last scales are added later, the
    # tuple order in POSTTASK_SCALES_AI defines their relative order.
    return free + pinned


def derive_seed(*parts: str) -> int:
    """Stable 31-bit seed from string parts. Used when a seed isn't supplied.

    Stable across processes — the same (group_id, role, phase) always hashes
    to the same seed. Callers that want true randomness can pass
    random.randint(...) instead.
    """
    h = hashlib.sha256("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(h[:4], "big") & 0x7FFFFFFF
