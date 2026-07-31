# Contributing to SAI-P4

Thanks for your interest in improving SAI-P4. This is a research toolkit, so a few conventions matter more than usual.

## Development setup

```bash
./scripts/setup.sh          # venv + frontend deps + DB
source .venv/bin/activate
```

## Verifying changes

**Backend**

```bash
# Import smoke test
PYTHONPATH=backend python3 -c "from app.main import app; print('OK')"

# Module probes (loggers, audio, transcriber, TTS, facilitator, quality gate, …)
PYTHONPATH=backend python3 backend/scripts/probes/run_probes.py

# End-to-end session driver + validator
PYTHONPATH=backend python3 backend/scripts/e2e/run_session.py
PYTHONPATH=backend python3 backend/scripts/e2e/validate.py
```

**Frontend**

```bash
cd frontend
npm run typecheck           # tsc --noEmit — must be clean
npm run build               # tsc && vite build
```

## Ground rules

1. **One config source.** Every experiment parameter lives in `backend/app/config.py`. If a tunable value appears anywhere else, that's a bug.
2. **Never break logging.** Loggers are append-only JSONL with synchronous flush-on-write. Do not batch or buffer — data integrity beats throughput.
3. **Condition behaviour lives in prompts.** The five condition behaviours are defined by `backend/prompts/c1–c5.txt` and validated by `quality_gate.txt`. Changing prompt wording changes the experiment — treat prompts as stimuli and document any change in `docs/CONDITIONS.md`.
4. **`{anchor_option}` and `{target_participant}`** are the only `.format()` placeholders allowed in prompt files (C3 and C4 respectively). Any other `{ }` in a prompt will crash prompt rendering.
5. **`await` all async paths.** State-machine and orchestrator methods are async. Never `asyncio.ensure_future` in those paths (it swallows exceptions).
6. **No bare `except: pass`.** Log with `log.warning(f"...: {e}")`.
7. **Add new events to the registry.** New event-emitting features add a value to `EventType` in `backend/app/models.py` and emit an `EventEntry`.

## Pull requests

- Keep changes focused; one concern per PR.
- Run the backend probes and `npm run typecheck` before opening a PR, and note the results.
- Describe any change to prompts, tasks, or the state machine explicitly — these affect experimental validity.
