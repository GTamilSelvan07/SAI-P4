"""
SQLite database for session and group tracking.
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager

from app.config import DB_PATH


def init_db() -> None:
    """Create tables if they don't exist; migrate older schemas in place.

    Tables are FK-free by design — JSONL is the source of truth for
    experiment data, so DB-level referential integrity has been a recurring
    source of breakage (hot-reload, DB clear, role rows that don't exist
    in `participants`). The same rationale that drove the surveys-FK
    migration applies to sessions/participants/groups.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS groups (
                group_id TEXT PRIMARY KEY,
                conditions TEXT NOT NULL,  -- JSON array; single-run mode writes one element
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                block_number INTEGER NOT NULL,  -- always 1 in single-run mode (vestigial)
                condition TEXT NOT NULL,
                task_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',  -- pending/active/completed/aborted
                created_at REAL NOT NULL,
                started_at REAL,
                ended_at REAL,
                model TEXT NOT NULL DEFAULT 'gemma4:26b',
                anchoring_direction TEXT  -- 'correct'/'incorrect' for C3
            );

            CREATE TABLE IF NOT EXISTS participants (
                participant_id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                role TEXT NOT NULL,  -- 'P1' or 'P2'
                name TEXT,
                demographics TEXT  -- JSON
            );

            CREATE TABLE IF NOT EXISTS surveys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                participant_id TEXT NOT NULL,  -- P1/P2 role identifier
                survey_type TEXT NOT NULL,  -- 'pre_preference'/'post_task'/'debrief'
                condition TEXT NOT NULL,
                task_id TEXT NOT NULL,
                responses TEXT NOT NULL,  -- JSON
                submitted_at REAL NOT NULL,
                UNIQUE(session_id, participant_id, survey_type)
            );
        """)

        # --- Migration: remove FK constraints from surveys table ---
        # See module-level rationale.
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='surveys'"
        ).fetchone()
        if row and "REFERENCES" in (row[0] or ""):
            conn.executescript("""
                ALTER TABLE surveys RENAME TO surveys_old;
                CREATE TABLE surveys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    participant_id TEXT NOT NULL,
                    survey_type TEXT NOT NULL,
                    condition TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    responses TEXT NOT NULL,
                    submitted_at REAL NOT NULL,
                    UNIQUE(session_id, participant_id, survey_type)
                );
                INSERT OR IGNORE INTO surveys
                    SELECT * FROM surveys_old;
                DROP TABLE surveys_old;
            """)

        # --- Migration: drop bibd_block_index AND drop FKs on groups/sessions/participants ---
        # Three states this handles:
        #   (a) Old schema: `groups` has bibd_block_index NOT NULL.
        #   (b) Modern schema with stale FKs: `sessions`/`participants` REFERENCES groups.
        #   (c) Stuck mid-migration from a prior buggy commit: `groups_old` table left
        #       behind because the original DROP failed under foreign_keys=ON.
        groups_row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='groups'"
        ).fetchone()
        sessions_row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'"
        ).fetchone()
        participants_row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='participants'"
        ).fetchone()
        groups_old_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='groups_old'"
        ).fetchone() is not None

        groups_has_bibd = bool(groups_row and "bibd_block_index" in (groups_row[0] or ""))
        sessions_has_fk = bool(sessions_row and "REFERENCES" in (sessions_row[0] or ""))
        participants_has_fk = bool(participants_row and "REFERENCES" in (participants_row[0] or ""))

        needs_migration = (
            groups_has_bibd or sessions_has_fk or participants_has_fk or groups_old_exists
        )

        if needs_migration:
            conn.execute("PRAGMA foreign_keys = OFF")
            try:
                # Recover from a prior failed migration: rename groups_old back so
                # the standard rebuild path below works uniformly.
                if groups_old_exists and not groups_row:
                    conn.execute("ALTER TABLE groups_old RENAME TO groups")
                elif groups_old_exists and groups_row:
                    conn.execute("DROP TABLE groups_old")

                conn.executescript("""
                    ALTER TABLE groups RENAME TO _groups_mig;
                    ALTER TABLE sessions RENAME TO _sessions_mig;
                    ALTER TABLE participants RENAME TO _participants_mig;

                    CREATE TABLE groups (
                        group_id TEXT PRIMARY KEY,
                        conditions TEXT NOT NULL,
                        created_at REAL NOT NULL
                    );
                    CREATE TABLE sessions (
                        session_id TEXT PRIMARY KEY,
                        group_id TEXT NOT NULL,
                        block_number INTEGER NOT NULL,
                        condition TEXT NOT NULL,
                        task_id TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at REAL NOT NULL,
                        started_at REAL,
                        ended_at REAL,
                        model TEXT NOT NULL DEFAULT 'gemma4:26b',
                        anchoring_direction TEXT
                    );
                    CREATE TABLE participants (
                        participant_id TEXT PRIMARY KEY,
                        group_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        name TEXT,
                        demographics TEXT
                    );

                    INSERT OR IGNORE INTO groups (group_id, conditions, created_at)
                        SELECT group_id, conditions, created_at FROM _groups_mig;
                    INSERT OR IGNORE INTO sessions
                        (session_id, group_id, block_number, condition, task_id, status,
                         created_at, started_at, ended_at, model, anchoring_direction)
                        SELECT session_id, group_id, block_number, condition, task_id, status,
                               created_at, started_at, ended_at, model, anchoring_direction
                        FROM _sessions_mig;
                    INSERT OR IGNORE INTO participants
                        (participant_id, group_id, role, name, demographics)
                        SELECT participant_id, group_id, role, name, demographics
                        FROM _participants_mig;

                    DROP TABLE _groups_mig;
                    DROP TABLE _sessions_mig;
                    DROP TABLE _participants_mig;
                """)
            finally:
                conn.execute("PRAGMA foreign_keys = ON")

        # --- Questionnaire-battery integration (spec 2026-05-09) ---
        # Additive: extend `groups` with intake/debrief lifecycle columns and
        # create three new tables. FK-free per module rationale. The existing
        # `surveys` table is left in place; rename to `surveys_legacy` happens
        # in Step 8 when the new posttask path replaces the websocket survey
        # handler in routes/websockets.py.
        existing_group_cols = {
            row[1] for row in conn.execute("PRAGMA table_info(groups)").fetchall()
        }
        new_group_cols = [
            ("status", "TEXT NOT NULL DEFAULT 'pending'"),
            ("p1_label", "TEXT"),
            ("p2_label", "TEXT"),
            ("p1_intake_done_at", "TEXT"),
            ("p2_intake_done_at", "TEXT"),
            ("p1_debrief_done_at", "TEXT"),
            ("p2_debrief_done_at", "TEXT"),
            ("notes", "TEXT"),
            ("metadata_json", "TEXT"),
        ]
        for col_name, col_def in new_group_cols:
            if col_name not in existing_group_cols:
                conn.execute(f"ALTER TABLE groups ADD COLUMN {col_name} {col_def}")

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS demographics (
                demo_id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('P1','P2')),
                age INTEGER,
                gender TEXT,
                first_language TEXT,
                english_prof TEXT,
                education TEXT,
                prior_ai_xp TEXT,
                voice_asst_use TEXT,
                submitted_at TEXT NOT NULL,
                UNIQUE(group_id, role)
            );

            CREATE TABLE IF NOT EXISTS battery_responses (
                response_id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                session_id TEXT,                      -- NULL for intake & debrief
                role TEXT NOT NULL CHECK(role IN ('P1','P2')),
                phase TEXT NOT NULL CHECK(phase IN ('intake','posttask','debrief')),
                scale_id TEXT NOT NULL,
                responses_json TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                duration_ms INTEGER,
                registry_version TEXT NOT NULL,
                UNIQUE(group_id, session_id, role, phase, scale_id)
            );

            CREATE TABLE IF NOT EXISTS battery_orders (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                session_id TEXT,
                role TEXT NOT NULL CHECK(role IN ('P1','P2')),
                phase TEXT NOT NULL CHECK(phase IN ('intake','posttask','debrief')),
                ordered_scale_ids TEXT NOT NULL,      -- JSON array
                seed INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(group_id, session_id, role, phase)
            );

            CREATE INDEX IF NOT EXISTS idx_battery_responses_group_phase
                ON battery_responses(group_id, role, phase);
            CREATE INDEX IF NOT EXISTS idx_battery_responses_session
                ON battery_responses(session_id);

            -- Partial unique indexes for the NULL-session_id case (intake/debrief).
            -- The composite UNIQUE on the table doesn't dedupe across NULLs because
            -- SQL treats NULL as distinct in UNIQUE constraints. Without these, a
            -- repeat POST to the same intake scale creates a duplicate row.
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_battery_responses_no_session
                ON battery_responses(group_id, role, phase, scale_id)
                WHERE session_id IS NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_battery_orders_no_session
                ON battery_orders(group_id, role, phase)
                WHERE session_id IS NULL;
        """)

        # --- Retire legacy surveys table (FU1, 2026-05-09) ---
        # The new posttask path writes to battery_responses; the WS handler
        # no longer writes to `surveys`. Rename the table to surveys_legacy
        # so the data is preserved (52 rows from prior pilots) but no future
        # writes land there. Idempotent: only renames if `surveys` exists
        # AND `surveys_legacy` does not yet.
        surveys_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='surveys'"
        ).fetchone() is not None
        legacy_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='surveys_legacy'"
        ).fetchone() is not None
        if surveys_exists and not legacy_exists:
            conn.execute("ALTER TABLE surveys RENAME TO surveys_legacy")


@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # better concurrent reads
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
