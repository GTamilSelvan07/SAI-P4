"""
Walk a session output directory and apply the artifact matrix.
Used by run_session.py after a per-condition E2E run completes.
"""
from __future__ import annotations
import json
import sqlite3
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


def _wav_info(path: Path) -> tuple[int, int]:
    """Return (n_frames, sample_rate). (0, 0) if missing or unreadable."""
    if not path.exists():
        return 0, 0
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes(), w.getframerate()
    except Exception:
        return 0, 0


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def _read_session_mode(session_dir: Path) -> str:
    """Read 'mode' from session_meta.json. Returns 'study' if missing/unreadable."""
    meta_path = session_dir / "session_meta.json"
    if not meta_path.exists():
        return "study"
    try:
        meta = json.loads(meta_path.read_text())
        return str(meta.get("mode", "study"))
    except Exception:
        return "study"


def validate_session(session_dir: Path, condition: str, db_path: Path) -> list[Check]:
    """Apply artifact + behavioral matrix to a finished session directory."""
    checks: list[Check] = []

    # 1-2: P1 / P2 audio
    for role, fname in (("P1", "audio_p1.wav"), ("P2", "audio_p2.wav")):
        n, sr = _wav_info(session_dir / fname)
        ok = n > 0 and sr == 16000
        checks.append(Check(
            name=fname,
            passed=ok,
            detail=f"frames={n}, sr={sr}" if ok else f"missing or invalid (frames={n}, sr={sr})",
        ))

    # 3: alex audio
    # Note: in E2E with manual phase advance, time-based triggers don't fire,
    # so for non-C0 conditions we accept "0 frames if 0 interventions" (consistency)
    # — the cross-check is done after counting events.jsonl below.
    n_alex, sr_alex = _wav_info(session_dir / "audio_alex.wav")

    # 4: mixed audio
    n, sr = _wav_info(session_dir / "audio_mixed.wav")
    ok = n > 0
    checks.append(Check("audio_mixed.wav", ok, f"frames={n}"))

    # 5: transcript
    transcript = _read_jsonl(session_dir / "transcript.jsonl")
    n_p1 = sum(1 for e in transcript if e.get("speaker") == "P1")
    n_p2 = sum(1 for e in transcript if e.get("speaker") == "P2")
    n_alex = sum(1 for e in transcript if e.get("speaker") == "Alex")
    checks.append(Check(
        name="transcript.jsonl",
        passed=len(transcript) > 0,
        detail=f"{len(transcript)} entries (P1={n_p1}, P2={n_p2}, Alex={n_alex})",
    ))

    # 6: events
    events = _read_jsonl(session_dir / "events.jsonl")
    types = [e.get("type") for e in events]
    has_start = "session_start" in types
    has_end = "session_end" in types
    has_phase = any(t == "phase_change" for t in types)
    n_intervention = sum(1 for t in types if t == "ai_intervention")
    n_quality_fail = sum(1 for t in types if t == "ai_quality_gate_fail")

    required = has_start and has_end and has_phase
    detail = (
        f"{len(events)} total: start={has_start}, end={has_end}, "
        f"phase_changes={sum(1 for t in types if t == 'phase_change')}, "
        f"interventions={n_intervention}, qg_fails={n_quality_fail}"
    )
    checks.append(Check("events.jsonl (core)", required, detail))

    # Cross-check: alex audio frames should be consistent with intervention count.
    # If interventions were fired, audio should be present. If 0 interventions, 0 frames is fine.
    if condition == "C0":
        ok = n_alex == 0
        checks.append(Check("audio_alex.wav (C0)", ok, f"frames={n_alex} (expected 0)"))
    else:
        if n_intervention > 0:
            ok = n_alex > 0 and sr_alex == 16000
            detail = f"frames={n_alex}, sr={sr_alex} (interventions={n_intervention})"
        else:
            # Manual phase advance methodology: triggers didn't have time to fire
            ok = n_alex == 0
            detail = f"frames=0 (no interventions fired — manual advance methodology)"
        checks.append(Check("audio_alex.wav", ok, detail))

    # Per-condition behavioral check
    if condition == "C0":
        ok = n_intervention == 0
        checks.append(Check("C0 no interventions", ok, f"intervention_count={n_intervention}"))
    else:
        # C1-C5: with manual phase advance the time-based triggers don't fire.
        # A2 probe_facilitator covers the actual intervention path. Just report.
        checks.append(Check(f"{condition} interventions (informational)", True,
                            f"intervention_count={n_intervention} (E2E methodology limit)"))

    # 7: lsl markers
    lsl_path = session_dir / "lsl_markers.csv"
    if lsl_path.exists():
        n_lines = sum(1 for _ in lsl_path.read_text().splitlines())
        checks.append(Check("lsl_markers.csv", n_lines > 0, f"{n_lines} lines"))
    else:
        checks.append(Check("lsl_markers.csv", False, "missing"))

    # 8: DB rows (sessions). Session ID is the dirname minus the trailing _YYYYMMDD_HHMMSS.
    # Format: "{group_number}_{condition}_{ts}" → session_id = "{group_number}_{condition}".
    parts = session_dir.name.rsplit("_", 2)  # ['245_C0', '20260408', '080405']
    session_id = parts[0] if len(parts) >= 3 else session_dir.name
    if db_path.exists():
        try:
            conn = sqlite3.connect(str(db_path))
            row = conn.execute(
                "SELECT status FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if row:
                checks.append(Check("sessions table row", True, f"id={session_id} status={row[0]}"))
            else:
                checks.append(Check("sessions table row", False, f"no row for session_id={session_id}"))
            conn.close()
        except Exception as e:
            checks.append(Check("sessions table row", False, f"db err: {e}"))
    else:
        checks.append(Check("sessions table row", False, f"db missing at {db_path}"))

    return checks


def print_matrix(condition: str, checks: Iterable[Check]) -> bool:
    print(f"\n=== {condition} validation matrix ===")
    all_ok = True
    for c in checks:
        marker = "PASS" if c.passed else "FAIL"
        print(f"  [{marker}] {c.name:<28} {c.detail}")
        if not c.passed:
            all_ok = False
    return all_ok


def find_latest_session_dir(data_root: Path, session_id: str) -> Path | None:
    """Find the most recently created data/sessions/{session_id}_* directory."""
    if not data_root.exists():
        return None
    matches = sorted(data_root.glob(f"{session_id}_*"), key=lambda p: p.stat().st_mtime, reverse=True)
    return matches[0] if matches else None
