"""
Post-hoc baseline metrics for a single experiment session.

Useful for every condition; load-bearing for C0 (no-AI baseline) because
without intervention metrics there's nothing else to measure the discussion
dynamics by.

Reads JSONL artifacts only — no app imports, no DB. Run:

    PYTHONPATH=backend python3 backend/scripts/analysis/compute_metrics.py <session_dir>
    PYTHONPATH=backend python3 backend/scripts/analysis/compute_metrics.py --aggregate <data_dir>

Per-session output: <session_dir>/metrics.json
Aggregator output: <data_dir>/metrics_by_condition.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

# ── Constants ─────────────────────────────────────────────────────────────

# Tiny stop-word list used for token-overlap on info_pool_coverage. Kept
# small on purpose — research-task content words are distinctive enough that
# a heavy NLP list is overkill, and this stays auditable.
STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "of", "in", "on",
    "at", "for", "with", "to", "from", "by", "as", "is", "are", "was",
    "were", "be", "been", "being", "have", "has", "had", "do", "does",
    "did", "will", "would", "can", "could", "should", "may", "might",
    "must", "this", "that", "these", "those", "it", "its", "they", "them",
    "their", "he", "she", "his", "her", "hers", "him", "we", "us", "our",
    "ours", "you", "your", "yours", "i", "me", "my", "mine",
}

INFO_BULLET_OVERLAP_THRESHOLD = 0.5  # ≥50% of content words present → "surfaced"


# ── Data loaders ──────────────────────────────────────────────────────────

def _read_jsonl(path: Path) -> list[dict]:
    out: list[dict] = []
    if not path.exists():
        return out
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                # Tolerate partial last line (e.g., crash-recovered JSONL).
                continue
    return out


def _load_task(task_id: str, project_root: Path) -> dict | None:
    task_path = project_root / "backend" / "tasks" / f"{task_id}.json"
    if not task_path.exists():
        return None
    return json.loads(task_path.read_text())


# ── Phase boundaries ──────────────────────────────────────────────────────

def _phase_window(events: list[dict], phase: str, now: float | None = None) -> tuple[float, float] | None:
    """
    Returns (start_ts, end_ts) for the named phase (epoch seconds), or None
    if the phase didn't fire. End is the next phase_change ts after start, or
    SESSION_END ts if it was the last phase. If `now` is provided and the
    phase hasn't ended yet, uses `now` as the right edge — for live mid-phase
    metrics computation.
    """
    start_ts: float | None = None
    end_ts: float | None = None
    for ev in events:
        if ev.get("type") == "phase_change":
            if ev.get("phase") == phase and start_ts is None:
                start_ts = float(ev["ts"])
            elif start_ts is not None and end_ts is None:
                end_ts = float(ev["ts"])
                break
        elif ev.get("type") == "session_end" and start_ts is not None and end_ts is None:
            end_ts = float(ev["ts"])
            break
    if start_ts is None:
        return None
    if end_ts is None:
        if now is not None and now > start_ts:
            return start_ts, now
        # Phase started but no terminator recorded — caller asked for the
        # closed-window semantics, so skip duration-dependent metrics.
        return None
    return start_ts, end_ts


def _entries_in_window(transcript: list[dict], window: tuple[float, float]) -> list[dict]:
    start, end = window
    return [e for e in transcript if start <= float(e.get("ts", 0)) < end]


# ── Metrics ───────────────────────────────────────────────────────────────

def turn_balance_ratio(entries: list[dict]) -> float | None:
    """P1 speak time ÷ (P1 + P2 speak time). 0.5 = perfectly balanced."""
    p1 = sum(int(e["end_ms"]) - int(e["start_ms"]) for e in entries if e.get("speaker") == "P1")
    p2 = sum(int(e["end_ms"]) - int(e["start_ms"]) for e in entries if e.get("speaker") == "P2")
    total = p1 + p2
    if total <= 0:
        return None
    return round(p1 / total, 4)


def interruption_rate_per_min(entries: list[dict], window_seconds: float) -> float | None:
    """
    Count consecutive transcript entries where speakers differ AND
    entry[k+1].start_ms < entry[k].end_ms (overlap). Normalize per minute.
    """
    if window_seconds <= 0:
        return None
    pp_entries = [e for e in entries if e.get("speaker") in ("P1", "P2")]
    pp_entries = sorted(pp_entries, key=lambda e: int(e["start_ms"]))
    overlaps = 0
    for k in range(len(pp_entries) - 1):
        a, b = pp_entries[k], pp_entries[k + 1]
        if a.get("speaker") == b.get("speaker"):
            continue
        if int(b["start_ms"]) < int(a["end_ms"]):
            overlaps += 1
    return round(overlaps / (window_seconds / 60.0), 3)


def _content_words(text: str) -> set[str]:
    cleaned = "".join(c.lower() if c.isalnum() else " " for c in text)
    return {w for w in cleaned.split() if len(w) >= 4 and w not in STOPWORDS}


def info_pool_coverage(entries: list[dict], task: dict) -> dict[str, float | int | None]:
    """
    For each P1/P2 unique-info bullet, fraction of its content words that
    appear in the discussion transcript text. Bullet counts as "surfaced"
    if overlap ≥ INFO_BULLET_OVERLAP_THRESHOLD.
    """
    transcript_text = " ".join(e.get("text", "") for e in entries if e.get("speaker") in ("P1", "P2"))
    transcript_words = _content_words(transcript_text)

    def _coverage(bullets: list[str]) -> float | None:
        if not bullets:
            return None
        surfaced = 0
        for bullet in bullets:
            words = _content_words(bullet)
            if not words:
                continue
            overlap = len(words & transcript_words) / len(words)
            if overlap >= INFO_BULLET_OVERLAP_THRESHOLD:
                surfaced += 1
        return round(surfaced / len(bullets), 4)

    p1_bullets = task.get("p1_unique_info", [])
    p2_bullets = task.get("p2_unique_info", [])
    p1 = _coverage(p1_bullets)
    p2 = _coverage(p2_bullets)
    total_count = len(p1_bullets) + len(p2_bullets)
    if total_count == 0:
        return {"total": None, "p1": p1, "p2": p2}
    p1_surf = (p1 or 0) * len(p1_bullets)
    p2_surf = (p2 or 0) * len(p2_bullets)
    return {
        "total": round((p1_surf + p2_surf) / total_count, 4),
        "p1": p1,
        "p2": p2,
    }


def time_to_first_option_mention_ms(
    entries: list[dict], window_start_ts: float, task: dict
) -> int | None:
    """
    ms from open_discussion start to the first transcript line containing
    any candidate name from the task. Indicates how quickly the group
    starts converging on options.
    """
    candidates: list[str] = [c.get("name", "") for c in task.get("candidates", [])]
    candidates = [c.lower() for c in candidates if c]
    if not candidates:
        return None
    for e in entries:
        if e.get("speaker") not in ("P1", "P2"):
            continue
        text = (e.get("text") or "").lower()
        if any(name in text for name in candidates):
            return int((float(e["ts"]) - window_start_ts) * 1000)
    return None


def decision_correctness(events: list[dict], task: dict) -> bool | None:
    """
    Bool: did the group reach the task's correct_answer?
    Reads the latest DECISION_CONSENSUS event; None if no consensus reached.
    """
    correct = task.get("correct_answer")
    if not correct:
        return None
    for ev in reversed(events):
        if ev.get("type") == "decision_consensus":
            choice = (ev.get("extra") or {}).get("choice")
            if choice is None:
                return None
            return str(choice).strip().upper() == str(correct).strip().upper()
    return None


# ── Per-session driver ────────────────────────────────────────────────────

@dataclass
class SessionMetrics:
    session_id: str
    condition: str | None
    task_id: str | None
    open_discussion_seconds: float | None
    turn_balance_ratio: float | None
    interruption_rate_per_min: float | None
    info_pool_coverage_total: float | None
    info_pool_coverage_p1: float | None
    info_pool_coverage_p2: float | None
    time_to_first_option_mention_ms: int | None
    decision_correctness: bool | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "condition": self.condition,
            "task_id": self.task_id,
            "open_discussion_seconds": self.open_discussion_seconds,
            "turn_balance_ratio": self.turn_balance_ratio,
            "interruption_rate_per_min": self.interruption_rate_per_min,
            "info_pool_coverage": {
                "total": self.info_pool_coverage_total,
                "p1": self.info_pool_coverage_p1,
                "p2": self.info_pool_coverage_p2,
            },
            "time_to_first_option_mention_ms": self.time_to_first_option_mention_ms,
            "decision_correctness": self.decision_correctness,
        }


def compute_session_metrics(
    session_dir: Path,
    project_root: Path,
    *,
    now: float | None = None,
) -> SessionMetrics:
    """Compute per-session metrics.

    If `now` is provided, the open_discussion window is closed at `now` when
    the phase hasn't ended yet — supports live mid-phase computation.
    Default (None) keeps the closed-window semantics for completed sessions.
    """
    transcript = _read_jsonl(session_dir / "transcript.jsonl")
    events = _read_jsonl(session_dir / "events.jsonl")
    meta_path = session_dir / "session_meta.json"
    meta: dict = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    session_id = meta.get("session_id") or session_dir.name
    conditions = meta.get("conditions") or []
    condition = conditions[0] if conditions else meta.get("condition")
    task_order = meta.get("task_order") or []
    task_id = task_order[0] if task_order else None

    task = _load_task(task_id, project_root) if task_id else None

    window = _phase_window(events, "open_discussion", now=now)
    if window is None:
        return SessionMetrics(
            session_id=session_id,
            condition=condition,
            task_id=task_id,
            open_discussion_seconds=None,
            turn_balance_ratio=None,
            interruption_rate_per_min=None,
            info_pool_coverage_total=None,
            info_pool_coverage_p1=None,
            info_pool_coverage_p2=None,
            time_to_first_option_mention_ms=None,
            decision_correctness=decision_correctness(events, task) if task else None,
        )

    duration = window[1] - window[0]
    entries = _entries_in_window(transcript, window)

    cov = info_pool_coverage(entries, task) if task else {"total": None, "p1": None, "p2": None}

    return SessionMetrics(
        session_id=session_id,
        condition=condition,
        task_id=task_id,
        open_discussion_seconds=round(duration, 2),
        turn_balance_ratio=turn_balance_ratio(entries),
        interruption_rate_per_min=interruption_rate_per_min(entries, duration),
        info_pool_coverage_total=cov.get("total"),
        info_pool_coverage_p1=cov.get("p1"),
        info_pool_coverage_p2=cov.get("p2"),
        time_to_first_option_mention_ms=(
            time_to_first_option_mention_ms(entries, window[0], task) if task else None
        ),
        decision_correctness=decision_correctness(events, task) if task else None,
    )


# ── Aggregator ────────────────────────────────────────────────────────────

CSV_COLUMNS = [
    "session_id",
    "condition",
    "task_id",
    "open_discussion_seconds",
    "turn_balance_ratio",
    "interruption_rate_per_min",
    "info_pool_coverage_total",
    "info_pool_coverage_p1",
    "info_pool_coverage_p2",
    "time_to_first_option_mention_ms",
    "decision_correctness",
]


def _flatten(m: SessionMetrics) -> dict[str, Any]:
    d = m.to_dict()
    cov = d.pop("info_pool_coverage")
    d["info_pool_coverage_total"] = cov["total"]
    d["info_pool_coverage_p1"] = cov["p1"]
    d["info_pool_coverage_p2"] = cov["p2"]
    return d


def aggregate(data_dir: Path, project_root: Path, out_csv: Path) -> int:
    rows: list[dict[str, Any]] = []
    if not data_dir.exists():
        return 0
    for session_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        try:
            m = compute_session_metrics(session_dir, project_root)
        except Exception as e:
            print(f"[skip] {session_dir.name}: {e}", file=sys.stderr)
            continue
        rows.append(_flatten(m))

    if not rows:
        return 0

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in CSV_COLUMNS})
    return len(rows)


# ── CLI ───────────────────────────────────────────────────────────────────

def _project_root() -> Path:
    # backend/scripts/analysis/compute_metrics.py → project root is parents[3].
    return Path(__file__).resolve().parents[3]


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    parser.add_argument("session_dir", nargs="?", help="path to one session directory")
    parser.add_argument(
        "--aggregate",
        metavar="DATA_DIR",
        help="walk DATA_DIR and emit metrics_by_condition.csv at its root",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    project_root = _project_root()

    if args.aggregate:
        data_dir = Path(args.aggregate).resolve()
        out_csv = data_dir / "metrics_by_condition.csv"
        n = aggregate(data_dir, project_root, out_csv)
        print(f"Aggregated {n} sessions -> {out_csv}")
        return 0

    if not args.session_dir:
        parser.print_usage()
        return 2

    session_dir = Path(args.session_dir).resolve()
    if not session_dir.is_dir():
        print(f"Not a directory: {session_dir}", file=sys.stderr)
        return 2

    m = compute_session_metrics(session_dir, project_root)
    out_path = session_dir / "metrics.json"
    out_path.write_text(json.dumps(m.to_dict(), indent=2) + "\n")
    print(json.dumps(m.to_dict(), indent=2))
    print(f"\n[written] {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
