"""
Trigger logic for AI facilitator interventions.
Determines when Alex should speak based on timer, lull, keyword, or turn count.
"""
import time
import random
from dataclasses import dataclass, field
from typing import Optional

from app.config import config


@dataclass
class TriggerState:
    """Tracks state for trigger evaluation."""
    last_intervention_time: float = 0.0
    last_speech_time: float = 0.0
    turn_count_since_intervention: int = 0
    next_timer_target: float = 0.0
    enabled: bool = True

    def reset_after_intervention(self) -> None:
        now = time.time()
        self.last_intervention_time = now
        self.last_speech_time = now  # Reset silence counter to prevent lull re-firing
        self.turn_count_since_intervention = 0
        jitter = random.uniform(
            -config.triggers.timer_jitter_seconds,
            config.triggers.timer_jitter_seconds,
        )
        self.next_timer_target = now + config.triggers.timer_interval_seconds + jitter


class TriggerReason:
    TIMER = "timer"
    LULL = "lull"
    KEYWORD = "keyword"
    TURN_COUNT = "turn_count"


class TriggerEvaluator:
    """Evaluates whether Alex should intervene."""

    def __init__(self):
        self.state = TriggerState()

    def start(self) -> None:
        now = time.time()
        self.state.last_intervention_time = now
        self.state.last_speech_time = now
        jitter = random.uniform(
            -config.triggers.timer_jitter_seconds,
            config.triggers.timer_jitter_seconds,
        )
        self.state.next_timer_target = now + config.triggers.timer_interval_seconds + jitter
        self.state.enabled = True

    def disable(self) -> None:
        self.state.enabled = False

    def enable(self) -> None:
        self.state.enabled = True

    def on_speech(self, text: str = "") -> Optional[str]:
        """
        Called when a participant speaks.
        Updates state and checks keyword trigger.
        Returns trigger reason or None.
        """
        now = time.time()
        self.state.last_speech_time = now
        self.state.turn_count_since_intervention += 1

        if not self.state.enabled:
            return None

        # Keyword trigger: participant said "Alex"
        if config.triggers.keyword.lower() in text.lower():
            return TriggerReason.KEYWORD

        return None

    def evaluate(self) -> Optional[str]:
        """
        Called periodically (e.g., every second) to check time-based triggers.
        Returns trigger reason or None.
        """
        if not self.state.enabled:
            return None

        now = time.time()

        # Timer trigger
        if now >= self.state.next_timer_target:
            return TriggerReason.TIMER

        # Lull trigger (silence > threshold)
        silence_duration = now - self.state.last_speech_time
        if silence_duration >= config.triggers.lull_threshold_seconds:
            # Only fire lull if some time has passed since last intervention
            min_gap = config.triggers.timer_interval_seconds * 0.3
            if now - self.state.last_intervention_time >= min_gap:
                return TriggerReason.LULL

        # Turn count trigger
        if self.state.turn_count_since_intervention >= config.triggers.turn_count_threshold:
            return TriggerReason.TURN_COUNT

        return None

    @property
    def seconds_until_next(self) -> float:
        """Seconds until next timer trigger."""
        return max(0, self.state.next_timer_target - time.time())
