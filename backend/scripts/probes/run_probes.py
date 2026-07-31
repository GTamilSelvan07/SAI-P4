"""Run all probes sequentially and print a summary matrix."""
from __future__ import annotations
import sys
from pathlib import Path

# Ensure local imports
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from _common import Result  # noqa: E402
import probe_event_logger  # noqa: E402
import probe_transcript_logger  # noqa: E402
import probe_recorder  # noqa: E402
import probe_tts  # noqa: E402
import probe_transcriber  # noqa: E402
import probe_facilitator  # noqa: E402
import probe_quality_gate  # noqa: E402
import probe_task_hidden_profile  # noqa: E402
import probe_video_recorder  # noqa: E402
import probe_audio_manager_shutdown  # noqa: E402
import probe_preference_completion_guard  # noqa: E402
import time as _time  # noqa: E402


def _wrap_int_main(fn, name: str):
    """Adapt probes returning int (0=pass, !=0=fail) into Result objects."""
    def runner() -> Result:
        t0 = _time.time()
        rc = fn()
        elapsed = _time.time() - t0
        return Result(
            name=name,
            passed=(rc == 0),
            detail="OK" if rc == 0 else f"exit={rc}",
            elapsed_s=elapsed,
        )
    return runner


PROBES = [
    ("P1", probe_event_logger.main),
    ("P2", probe_transcript_logger.main),
    ("P3", probe_recorder.main),
    ("P5", probe_tts.main),
    ("P4", probe_transcriber.main),
    ("P6", probe_facilitator.main),
    ("P7", probe_quality_gate.main),
    ("P11", _wrap_int_main(probe_task_hidden_profile.main, "probe_task_hidden_profile")),
    ("P12", probe_video_recorder.main),
    ("P13", probe_audio_manager_shutdown.main),
    ("P14", probe_preference_completion_guard.main),
]


def main() -> int:
    print("=" * 72)
    print("A2 PROBE MATRIX")
    print("=" * 72)
    results: list[Result] = []
    for tag, fn in PROBES:
        print(f"\n--- {tag} ---")
        r = fn()
        results.append(r)

    print()
    print("=" * 72)
    print("SUMMARY")
    print("=" * 72)
    passed = sum(1 for r in results if r.passed)
    for r in results:
        marker = "PASS" if r.passed else "FAIL"
        print(f"  [{marker}] {r.name:<32} ({r.elapsed_s:6.2f}s) {r.detail[:80]}")
    print(f"\n{passed} / {len(results)} probes passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
