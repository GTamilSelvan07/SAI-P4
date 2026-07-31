"""
Run one block of one condition end-to-end via the SessionDriver, then validate.

Usage:
    python backend/scripts/e2e/run_session.py --condition C2 --task t1
"""
from __future__ import annotations
import argparse
import asyncio
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent))  # backend/

from driver import SessionDriver  # type: ignore
from validate import validate_session, print_matrix, find_latest_session_dir, Check  # type: ignore


REPO_ROOT = HERE.parent.parent.parent  # /Safe-AI
DATA_ROOT = REPO_ROOT / "data" / "sessions"
DB_PATH = REPO_ROOT / "db" / "experiment.db"
FIXTURES_DIR = REPO_ROOT / "backend" / "scripts" / "probes" / "fixtures"


# Map conditions to a default task that exists in backend/tasks/
DEFAULT_TASK = "candidate_selection"  # backend/tasks/candidate_selection.json


async def run_one(condition: str, task_id: str, group_number: int) -> tuple[bool, list[Check]]:
    p1_wav = FIXTURES_DIR / "p1_speech.wav"
    p2_wav = FIXTURES_DIR / "p2_speech.wav"
    if not p1_wav.exists() or not p2_wav.exists():
        print(f"FAIL: fixture missing — run generate_fixtures.py first")
        return False, []

    async with SessionDriver() as drv:
        print(f"[e2e {condition}] creating session…")
        meta = await drv.create_session(group_number=group_number, condition=condition, task_id=task_id)
        print(f"[e2e {condition}] session_id={drv.session_id}")

        print(f"[e2e {condition}] starting…")
        await drv.start_session()

        # Order matters: connect researcher first, then participants, then audio.
        # WS connection adds the role to the connected set; rtc_start fires when both Ps in.
        await drv.connect_ws_all()
        await drv.connect_audio_ws()
        await asyncio.sleep(0.5)  # allow audio_mgr to register sockets

        # Walk the 7 phases. We start in INFO_READING (after start_session).
        # We manually advance after a brief activity in each.

        # Phase 1: INFO_READING — no audio needed, advance immediately
        print(f"[e2e {condition}] phase: info_reading → advance")
        await drv.advance_phase()
        await asyncio.sleep(0.2)

        # Phase 2: PREFERENCE — no audio needed, advance immediately
        print(f"[e2e {condition}] phase: preference → advance")
        await drv.advance_phase()
        await asyncio.sleep(0.2)

        # Phase 3: P1_OPENING — stream P1 audio
        print(f"[e2e {condition}] phase: p1_opening → stream P1 audio")
        await drv.stream_wav("P1", p1_wav, chunk_ms=500)
        await drv.advance_phase()
        await asyncio.sleep(0.2)

        # Phase 4: P2_OPENING — stream P2 audio
        print(f"[e2e {condition}] phase: p2_opening → stream P2 audio")
        await drv.stream_wav("P2", p2_wav, chunk_ms=500)
        await drv.advance_phase()
        await asyncio.sleep(0.2)

        # Phase 5: OPEN_DISCUSSION — stream both
        print(f"[e2e {condition}] phase: open_discussion → stream both")
        await asyncio.gather(
            drv.stream_wav("P1", p1_wav, chunk_ms=500),
            drv.stream_wav("P2", p2_wav, chunk_ms=500),
        )
        await drv.advance_phase()
        await asyncio.sleep(0.2)

        # Phase 6: DECISION — both vote same
        print(f"[e2e {condition}] phase: decision → vote")
        await drv.submit_vote("P1", "Option A")
        await drv.submit_vote("P2", "Option A")
        await asyncio.sleep(0.5)
        await drv.advance_phase()
        await asyncio.sleep(0.2)

        # Phase 7: SURVEY — both submit
        print(f"[e2e {condition}] phase: survey → submit")
        task_for_survey = task_id
        await drv.submit_survey("P1", condition, task_for_survey)
        await drv.submit_survey("P2", condition, task_for_survey)
        # Survey auto-advances on both submissions
        await asyncio.sleep(1.0)

        # Wait briefly for session_end to propagate, then close
        await asyncio.sleep(1.0)

        # Stop session cleanly so loggers flush + post-hoc mix happens
        await drv.emergency_stop()
        await asyncio.sleep(1.0)

    # Find the session output directory
    session_dir = find_latest_session_dir(DATA_ROOT, drv.session_id)
    if session_dir is None:
        print(f"FAIL: no session output dir for {drv.session_id} under {DATA_ROOT}")
        return False, []
    print(f"[e2e {condition}] session_dir={session_dir}")

    checks = validate_session(session_dir, condition, DB_PATH)
    ok = print_matrix(condition, checks)
    return ok, checks


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--condition", required=True, choices=["C0", "C1", "C2", "C3", "C4", "C5"])
    p.add_argument("--task", default=DEFAULT_TASK)
    p.add_argument("--group", type=int, default=int(time.time()) % 1000)
    args = p.parse_args()

    ok, _ = asyncio.run(run_one(args.condition, args.task, args.group))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
