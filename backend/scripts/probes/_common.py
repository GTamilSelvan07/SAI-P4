"""Shared helpers for probe scripts."""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import sys
import time
import traceback


PROBES_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = PROBES_DIR / "fixtures"
REPO_ROOT = PROBES_DIR.parent.parent.parent  # /Safe-AI


def ensure_pythonpath() -> None:
    """Make `app.*` importable when running probes directly."""
    backend_dir = REPO_ROOT / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))


@dataclass
class Result:
    name: str
    passed: bool
    detail: str = ""
    elapsed_s: float = 0.0


def pass_(name: str, detail: str = "", elapsed_s: float = 0.0) -> Result:
    print(f"[PASS] {name:<32} {detail}")
    return Result(name=name, passed=True, detail=detail, elapsed_s=elapsed_s)


def fail_(name: str, detail: str = "", elapsed_s: float = 0.0) -> Result:
    print(f"[FAIL] {name:<32} {detail}")
    return Result(name=name, passed=False, detail=detail, elapsed_s=elapsed_s)


def run_probe(name: str, fn) -> Result:
    """Wrap a probe function with timing + exception handling."""
    t0 = time.time()
    try:
        result = fn()
        if isinstance(result, Result):
            result.elapsed_s = time.time() - t0
            return result
        # If function returned None or True, treat as PASS
        return pass_(name, "ok", time.time() - t0)
    except AssertionError as e:
        return fail_(name, f"assert: {e}", time.time() - t0)
    except Exception as e:
        return fail_(name, f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=2)}", time.time() - t0)
