"""P14: Initial preference data cannot be mistaken for posttask completion."""
from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

from _common import ensure_pythonpath, pass_, Result, run_probe

ensure_pythonpath()

from app.config import Condition, Phase
from app.models import SessionMeta
from app.routes.websockets import _handle_ws_message
from app.session.manager import ActiveSession
from app.session.orchestrator_registry import orchestrator_registry


class _Block:
    current_phase = Phase.PREFERENCE
    condition = Condition.C2_NEUTRAL
    task_id = "candidate_selection"


class _StateMachine:
    def __init__(self) -> None:
        self.current_block = _Block()
        self.advance_count = 0

    async def advance_phase(self) -> None:
        self.advance_count += 1


class _Orchestrator:
    def __init__(self) -> None:
        self.state_machine = _StateMachine()

    async def stop(self) -> None:
        pass


async def _exercise(tmp: Path) -> str:
    session_id = "probe_preference_guard"
    meta = SessionMeta(
        session_id=session_id,
        group_id="g999",
        mode="study",
        conditions=["C2"],
        task_order=["candidate_selection"],
        condition_task_map={"C2": "candidate_selection"},
    )
    session = ActiveSession(
        session_id=session_id,
        group_id="g999",
        group_number=999,
        session_dir=tmp,
        meta=meta,
        conditions=[Condition.C2_NEUTRAL],
        task_order=["candidate_selection"],
    )
    session.start()
    orch = _Orchestrator()
    orchestrator_registry.add(session_id, orch)
    try:
        for role in ("P1", "P2"):
            await _handle_ws_message(
                session,
                session_id,
                role,
                {
                    "type": "survey_response",
                    "data": {
                        "phase": "pre_preference",
                        "responses": {"initial_preference": "Option A"},
                    },
                },
            )
        assert orch.state_machine.advance_count == 0, "legacy preference survey_response advanced phase"
        assert session.surveys == {}, "legacy preference survey_response marked survey completion"
    finally:
        await orchestrator_registry.remove(session_id)
        session.stop("probe_done")

    ignored = 0
    for line in (tmp / "events.jsonl").read_text().splitlines():
        event = json.loads(line)
        if event.get("type") == "survey_response" and (event.get("extra") or {}).get("ignored_for_completion"):
            ignored += 1
    assert ignored == 2, f"expected 2 ignored survey_response audit events, got {ignored}"
    return "legacy preference survey_response logged but did not complete posttask"


def _probe() -> Result:
    with tempfile.TemporaryDirectory() as t:
        msg = asyncio.run(_exercise(Path(t)))
    return pass_("P14 preference completion guard", msg)


def main() -> Result:
    return run_probe("P14 preference completion guard", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
