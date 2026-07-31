"""Probe — Step 1 questionnaire battery backend.

End-to-end smoke test of /api/groups + /api/groups/.../battery + /api/sessions/.../posttask
using fastapi TestClient against a temp SQLite DB so the live DB is untouched.

Run with:
    PYTHONPATH=backend python3 backend/scripts/probes/probe_battery_routes.py
"""
import shutil
import sys
import sqlite3
import tempfile
from pathlib import Path


def main() -> int:
    tmp_dir = Path(tempfile.mkdtemp(prefix="step1_probe_"))
    tmp_db = tmp_dir / "test.db"
    tmp_data = tmp_dir / "data"
    tmp_data.mkdir()

    # Redirect DB and data dirs BEFORE importing the FastAPI app.
    import app.config as cfg
    cfg.DB_PATH = tmp_db
    cfg.PROJECT_ROOT = tmp_dir
    cfg.DATA_DIR = tmp_data / "sessions"
    cfg.DATA_DIR.mkdir(parents=True, exist_ok=True)

    import app.database as dbmod
    dbmod.DB_PATH = tmp_db

    # Lifespan startup (which calls init_db()) only runs when TestClient is
    # used as a context manager. Initialise the schema explicitly so all
    # branches of the probe work either way.
    dbmod.init_db()

    from fastapi.testclient import TestClient
    from app.main import app
    from app.battery.scale_registry import REGISTRY_VERSION

    client = TestClient(app)
    fails: list[str] = []

    def expect(label: str, cond: bool, detail: str = "") -> None:
        marker = "PASS" if cond else "FAIL"
        suffix = f" — {detail}" if detail and not cond else ""
        print(f"  [{marker}] {label}{suffix}")
        if not cond:
            fails.append(label)

    # ── 1. Group lifecycle ────────────────────────────────────────────
    print("\n[1] Group lifecycle")
    r = client.post("/api/groups", json={"p1_label": "Alice", "p2_label": "Bob"})
    expect("POST /api/groups → 200", r.status_code == 200, r.text)
    g = r.json()
    gid = g["group_id"]
    expect("group_id assigned", gid.startswith("g_"))
    expect("status pending", g["status"] == "pending")
    expect("join URLs returned", "p1_join_url" in g and "p2_join_url" in g)

    r = client.get("/api/groups")
    expect("GET /api/groups list",
           r.status_code == 200 and any(x["group_id"] == gid for x in r.json()))

    r = client.get(f"/api/groups/{gid}")
    expect("GET /api/groups/{id}", r.status_code == 200 and r.json()["group_id"] == gid)

    r = client.get("/api/groups/nonexistent_xxxxxx")
    expect("404 on missing group", r.status_code == 404)

    # ── 2. Demographics ───────────────────────────────────────────────
    print("\n[2] Demographics")
    demo_p1 = {"age": 27, "gender": "Woman", "first_language": "en",
               "english_prof": "Native", "education": "Bachelor",
               "prior_ai_xp": "Yes", "voice_asst_use": "Daily"}
    r = client.post(f"/api/groups/{gid}/demographics/P1", json=demo_p1)
    expect("POST demographics P1", r.status_code == 200)
    r = client.post(f"/api/groups/{gid}/demographics/P2",
                    json={**demo_p1, "gender": "Man"})
    expect("POST demographics P2", r.status_code == 200)
    r = client.get(f"/api/groups/{gid}/demographics/P1")
    expect("GET demographics P1 returns age",
           r.status_code == 200 and r.json()["age"] == 27)
    r = client.post(f"/api/groups/{gid}/demographics/P3", json=demo_p1)
    expect("400 on bad role", r.status_code == 400)

    p1_path = tmp_dir / "data" / "groups" / gid / "demographics_p1.json"
    expect("demographics_p1.json on disk",
           p1_path.exists() and "age" in p1_path.read_text())

    # ── 3. Intake battery (P1) ────────────────────────────────────────
    print("\n[3] Intake battery (P1)")
    r = client.get(f"/api/groups/{gid}/battery/P1/progress?phase=intake")
    expect("GET intake progress", r.status_code == 200, r.text)
    prog = r.json()
    expect("ordered_scale_ids has 5 intake scales", len(prog["ordered_scale_ids"]) == 5)
    expect("registry_version returned", prog["registry_version"] == REGISTRY_VERSION)
    expect("first GET creates seed", isinstance(prog["seed"], int))
    first_order = prog["ordered_scale_ids"]
    first_seed = prog["seed"]

    r2 = client.get(f"/api/groups/{gid}/battery/P1/progress?phase=intake")
    expect("order persists across GETs",
           r2.json()["ordered_scale_ids"] == first_order
           and r2.json()["seed"] == first_seed)

    for i, sid in enumerate(first_order):
        r = client.post(
            f"/api/groups/{gid}/battery/P1/{sid}",
            json={"responses": {"item_1": 4, "item_2": 5}, "duration_ms": 5000,
                  "phase": "intake", "registry_version": REGISTRY_VERSION},
        )
        expect(f"POST intake scale {sid}", r.status_code == 200, r.text)
        body = r.json()
        if i < len(first_order) - 1:
            expect(f"  next_scale_id non-null at {sid}", body["next_scale_id"] is not None)
            expect(f"  phase_complete=False at {sid}", body["phase_complete"] is False)
        else:
            expect("next_scale_id None on last", body["next_scale_id"] is None)
            expect("phase_complete=True on last", body["phase_complete"] is True)

    r = client.get(f"/api/groups/{gid}")
    expect("P1 intake_done_at set", r.json()["p1_intake_done"] is True)
    expect("status still pending (P2 not done)", r.json()["status"] == "pending")

    # Step-10 wiring: per-group lsl_markers.csv has one row per intake scale.
    lsl_path = tmp_dir / "data" / "groups" / gid / "lsl_markers.csv"
    expect("group lsl_markers.csv exists", lsl_path.exists())
    if lsl_path.exists():
        # Header + 5 intake rows + 1 dup-resubmit row = 7 lines minimum.
        n_lines = sum(1 for _ in lsl_path.open())
        expect("lsl rows ≥ 6 (header + 5 intake)", n_lines >= 6, f"got {n_lines}")
        # Marker name on first data row
        rows = list(lsl_path.open())
        if len(rows) >= 2:
            expect("first marker == intake_scale_submitted",
                   "intake_scale_submitted" in rows[1])

    # UPSERT — re-submit same scale, count stays the same
    r = client.post(
        f"/api/groups/{gid}/battery/P1/{first_order[0]}",
        json={"responses": {"item_1": 99}, "phase": "intake",
              "registry_version": REGISTRY_VERSION},
    )
    expect("re-submit same scale (UPSERT)", r.status_code == 200)
    with sqlite3.connect(str(tmp_db)) as c:
        n = c.execute(
            "SELECT COUNT(*) FROM battery_responses WHERE group_id=? AND role='P1' AND phase='intake'",
            (gid,),
        ).fetchone()[0]
    expect("intake response count == 5 (no dup row)", n == 5, f"got {n}")

    r = client.post(
        f"/api/groups/{gid}/battery/P1/bogus_scale",
        json={"responses": {}, "phase": "intake",
              "registry_version": REGISTRY_VERSION},
    )
    expect("400 on bogus scale_id", r.status_code == 400)

    r = client.post(
        f"/api/groups/{gid}/battery/P1/{first_order[0]}",
        json={"responses": {"item_1": 1}, "phase": "intake",
              "registry_version": "stale-version"},
    )
    expect("409 on registry mismatch", r.status_code == 409)

    # ── 4. P2 intake → ready ──────────────────────────────────────────
    print("\n[4] P2 intake → ready")
    r = client.get(f"/api/groups/{gid}/battery/P2/progress?phase=intake")
    p2_order = r.json()["ordered_scale_ids"]
    p2_seed = r.json()["seed"]
    for sid in p2_order:
        client.post(
            f"/api/groups/{gid}/battery/P2/{sid}",
            json={"responses": {"v": 1}, "phase": "intake",
                  "registry_version": REGISTRY_VERSION},
        )
    r = client.get(f"/api/groups/{gid}")
    expect("status → ready after both intakes", r.json()["status"] == "ready")
    expect("P1 and P2 have independent seeds", first_seed != p2_seed)

    # ── 5. Session creation under group ───────────────────────────────
    print("\n[5] Session creation")
    from app.tasks import task_registry
    task_registry.load_all()
    tasks = task_registry.list_tasks()
    if not tasks:
        print("  [SKIP] no task scenarios loaded; skipping session-creation probe")
        sid = None
    else:
        task_id = tasks[0]
        r = client.post(f"/api/groups/{gid}/sessions",
                        json={"condition": "C2", "task_id": task_id, "mode": "study"})
        expect("POST /api/groups/{id}/sessions", r.status_code == 200, r.text)
        sess = r.json()
        sid = sess["session_id"]
        expect("session_id returned", isinstance(sid, str))
        expect("session.group_id == real group_id", sess["group_id"] == gid)

        r = client.get(f"/api/groups/{gid}")
        expect("group → active", r.json()["status"] == "active")

        bad = client.post("/api/groups", json={}).json()["group_id"]
        client.post(f"/api/groups/{bad}/abort", json={"reason": "test"})
        r = client.post(f"/api/groups/{bad}/sessions",
                        json={"condition": "C2", "task_id": task_id})
        expect("409 on session-create for aborted group", r.status_code == 409)

        # ── 6. Posttask battery ───────────────────────────────────────
        print("\n[6] Posttask battery")
        r = client.get(f"/api/sessions/{sid}/posttask/P1/progress")
        expect("GET posttask progress", r.status_code == 200, r.text)
        pt = r.json()
        expect("posttask condition C2 → 11 scales", len(pt["ordered_scale_ids"]) == 11)
        expect("manipulation_check pinned last",
               pt["ordered_scale_ids"][-1] == "manipulation_check")

        sid_first = pt["ordered_scale_ids"][0]
        r = client.post(
            f"/api/sessions/{sid}/posttask/P1/{sid_first}",
            json={"responses": {"item_1": 5}, "duration_ms": 2000,
                  "registry_version": REGISTRY_VERSION},
        )
        expect("POST posttask scale", r.status_code == 200)

        # JSONL persisted under one of the timestamped session dirs
        session_dirs = list((tmp_data / "sessions").glob(f"{sid}*"))
        found_jsonl = any((d / "posttask_p1.jsonl").exists() for d in session_dirs)
        expect("posttask_p1.jsonl on disk", found_jsonl,
               f"looked in {[str(d) for d in session_dirs]}")

        r = client.post(
            f"/api/sessions/{sid}/posttask/P1/bogus",
            json={"responses": {}, "registry_version": REGISTRY_VERSION},
        )
        expect("400 on bogus posttask scale", r.status_code == 400)

        # Step-10 wiring: posttask LSL marker landed in the session CSV.
        sess_csvs = list((tmp_data / "sessions").glob(f"{sid}*/lsl_markers.csv"))
        if sess_csvs:
            text = sess_csvs[0].read_text()
            expect("session lsl_markers.csv has posttask marker",
                   "posttask_scale_submitted" in text)
        else:
            expect("session lsl_markers.csv exists", False, "no CSV found")

    # ── 7. End group ──────────────────────────────────────────────────
    print("\n[7] End group")
    r = client.post(f"/api/groups/{gid}/end")
    expect("POST /api/groups/{id}/end", r.status_code == 200, r.text)
    expect("group → completed", r.json()["status"] == "completed")

    shutil.rmtree(tmp_dir, ignore_errors=True)

    print("\n" + "=" * 50)
    if fails:
        print(f"FAILED ({len(fails)}):")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("ALL PROBES PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
