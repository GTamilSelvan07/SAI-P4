"""
Task loader — loads hidden-profile scenarios from JSON files.
"""
import json
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field

from app.config import TASKS_DIR


class Candidate(BaseModel):
    id: str
    name: str


class Task(BaseModel):
    id: str
    title: str
    description: str
    p1_persona: str
    p2_persona: str
    candidates: list[Candidate]
    correct_answer: str
    correct_rationale: str
    shared_info: list[str]
    p1_unique_info: list[str]
    p2_unique_info: list[str]
    anchor_option: str
    anchor_rationale: str
    slots: dict[str, str] = Field(default_factory=dict)


class TaskRegistry:
    """Loads and serves task scenarios."""

    def __init__(self):
        self._tasks: dict[str, Task] = {}

    def load_all(self) -> int:
        """Load all task JSON files. Returns count loaded."""
        TASKS_DIR.mkdir(parents=True, exist_ok=True)
        count = 0
        for json_file in sorted(TASKS_DIR.glob("*.json")):
            try:
                data = json.loads(json_file.read_text())
                task = Task(**data)
                self._tasks[task.id] = task
                count += 1
            except Exception as e:
                print(f"Warning: failed to load task {json_file.name}: {e}")
        return count

    def get(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def get_participant_view(self, task_id: str, role: str) -> Optional[dict]:
        """
        Get task info for a specific participant.
        Hides the other participant's unique info and the correct answer.
        """
        task = self._tasks.get(task_id)
        if not task:
            return None

        unique_info = task.p1_unique_info if role == "P1" else task.p2_unique_info
        persona = task.p1_persona if role == "P1" else task.p2_persona

        return {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "persona": persona,
            "candidates": [c.model_dump() for c in task.candidates],
            "shared_info": task.shared_info,
            "unique_info": unique_info,
        }

    def get_anchor_option(self, task_id: str) -> str:
        """Get the anchor option for C3 anchoring condition."""
        task = self._tasks.get(task_id)
        if not task:
            return ""
        # Return the candidate name for the anchor option
        for c in task.candidates:
            if c.id == task.anchor_option:
                return c.name
        return task.anchor_option

    def list_tasks(self) -> list[str]:
        return list(self._tasks.keys())

    @property
    def count(self) -> int:
        return len(self._tasks)


# Global registry
task_registry = TaskRegistry()
