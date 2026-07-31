"""P11: WebMRecorder lazy-open + bytes_written + status snapshot."""
from __future__ import annotations
import tempfile
from pathlib import Path

from _common import ensure_pythonpath, pass_, Result, run_probe

ensure_pythonpath()

from app.video.recorder import WebMRecorder, VideoRecorderManager, VideoRegistry


def _probe_lazy_open(tmp: Path) -> str:
    rec = WebMRecorder(tmp / "video_test.webm")
    assert not (tmp / "video_test.webm").exists(), "zombie file regression — file created before first chunk"
    assert not rec.is_active
    assert rec.bytes_written == 0
    assert rec.last_chunk_at is None

    rec.write_chunk(b"\x1a\x45\xdf\xa3" + b"\x00" * 100)
    assert (tmp / "video_test.webm").exists(), "file should exist after first chunk"
    assert rec.is_active
    assert rec.bytes_written == 104
    assert rec.last_chunk_at is not None

    rec.write_chunk(b"\x00" * 200)
    assert rec.bytes_written == 304

    rec.close()
    rec.close()  # idempotent
    return f"lazy-open OK; bytes_written={rec.bytes_written}"


def _probe_status_snapshot(tmp: Path) -> str:
    mgr = VideoRecorderManager(tmp)
    snap = mgr.status()
    assert "P1" in snap and "P2" in snap
    assert snap["P1"]["active"] is False
    assert snap["P1"]["bytes_written"] == 0
    assert snap["P1"]["last_chunk_age_s"] is None

    mgr.write_participant("P1", b"\x00" * 50)
    snap = mgr.status()
    assert snap["P1"]["active"] is True
    assert snap["P1"]["bytes_written"] == 50
    assert snap["P1"]["last_chunk_age_s"] is not None
    assert snap["P1"]["last_chunk_age_s"] < 1.0
    assert snap["P2"]["active"] is False

    mgr.write_participant("P3", b"\x00" * 10)  # unknown role: no-op
    mgr.close_all()
    return f"status snapshot OK; P1.bytes={snap['P1']['bytes_written']}"


def _probe_registry_lifecycle(tmp: Path) -> str:
    reg = VideoRegistry()
    sess = "sess_probe_123"
    assert reg.get(sess) is None

    mgr = reg.create(sess, tmp / "registry_session")
    assert reg.get(sess) is mgr
    assert not (tmp / "registry_session" / "video_p1.webm").exists()

    mgr.write_participant("P1", b"\x00" * 64)
    assert (tmp / "registry_session" / "video_p1.webm").exists()
    assert (tmp / "registry_session" / "video_p1.webm").stat().st_size == 64

    reg.remove(sess)
    assert reg.get(sess) is None
    return "registry lifecycle OK"


def _probe() -> Result:
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        m1 = _probe_lazy_open(tmp)
        m2 = _probe_status_snapshot(tmp)
        m3 = _probe_registry_lifecycle(tmp)
    return pass_("P11 video recorder", f"{m1}; {m2}; {m3}")


def main() -> Result:
    return run_probe("P11 video recorder", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
