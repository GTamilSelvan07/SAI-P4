"""P3: MultiChannelRecorder normal write + crash recovery + post-hoc mix."""
from __future__ import annotations
import math
import struct
import tempfile
import wave
from pathlib import Path

from _common import ensure_pythonpath, pass_, fail_, Result, run_probe

ensure_pythonpath()

from app.audio.recorder import MultiChannelRecorder, WavRecorder
from app.config import AUDIO_SAMPLE_RATE


def _gen_pcm16(seconds: float, freq: float = 440.0, amp: float = 0.2) -> bytes:
    n = int(seconds * AUDIO_SAMPLE_RATE)
    out = bytearray()
    for i in range(n):
        s = amp * math.sin(2 * math.pi * freq * i / AUDIO_SAMPLE_RATE)
        out += struct.pack("<h", max(-32768, min(32767, int(s * 32767))))
    return bytes(out)


def _probe_normal(tmp: Path) -> str:
    rec = MultiChannelRecorder(tmp)
    rec.open_all()
    pcm_3s = _gen_pcm16(3.0)
    rec.write_participant("P1", pcm_3s)
    rec.write_participant("P2", pcm_3s)
    rec.write_alex(pcm_3s)
    rec.close_all()

    expected_samples = int(3.0 * AUDIO_SAMPLE_RATE)  # 48000
    for fname in ("audio_p1.wav", "audio_p2.wav", "audio_alex.wav", "audio_mixed.wav"):
        f = tmp / fname
        assert f.exists(), f"{fname} missing"
        with wave.open(str(f), "rb") as w:
            n = w.getnframes()
            sr = w.getframerate()
            assert sr == AUDIO_SAMPLE_RATE, f"{fname} sample rate = {sr}, expected {AUDIO_SAMPLE_RATE}"
            assert abs(n - expected_samples) <= 4, f"{fname} frames = {n}, expected ~{expected_samples}"
    return f"4 wavs, {expected_samples} samples each"


def _probe_crash(tmp: Path) -> str:
    rec = WavRecorder(tmp / "audio_crash.wav")
    rec.open()
    pcm_1s = _gen_pcm16(1.0)
    rec.write_frames(pcm_1s)
    # Drop the recorder without close — simulate process death.
    # Python will still flush any buffered writes when the file object is GC'd
    # but may not finalize the WAV header. The wave module writes header on close().
    # So we explicitly test that the data we wrote is in the file.
    file_size = (tmp / "audio_crash.wav").stat().st_size
    # WAV header (no data) is 44 bytes. 1s of 16-bit mono at 16kHz = 32000 bytes.
    # We expect file_size >= 32000 + 0 (header may be incomplete but data is on disk).
    expected_data_bytes = AUDIO_SAMPLE_RATE * 2  # 32000
    assert file_size >= expected_data_bytes, (
        f"crash file size {file_size} < expected data {expected_data_bytes}"
    )
    return f"{file_size} bytes on disk after kill (data ≥ {expected_data_bytes})"


def _probe() -> Result:
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        normal_msg = _probe_normal(tmp)
        crash_msg = _probe_crash(tmp)
    return pass_("P3 recorder", f"normal: {normal_msg}; crash: {crash_msg}")


def main() -> Result:
    return run_probe("P3 recorder", _probe)


if __name__ == "__main__":
    import sys
    r = main()
    sys.exit(0 if r.passed else 1)
