import { useEffect } from "react";

interface ShortcutHandlers {
  onPauseToggle?: () => void;
  onAdvance?: () => void;
  onFailsafeFocus?: () => void;
  onEmergencyFocus?: () => void;
  onAnnotateFocus?: () => void;
  enabled?: boolean;
}

/**
 * Researcher-dashboard global keyboard shortcuts.
 *
 * Map:
 *   Space          → pause / resume
 *   ArrowRight     → advance phase
 *   F              → focus failsafe input (skip on C0 where it doesn't exist)
 *   Esc            → focus emergency-stop button
 *   Cmd/Ctrl+Enter → focus annotation bar (Wave 4)
 *
 * Discipline: never fire when a text-entry control is focused, so researchers
 * can type annotation notes without the page hijacking their keys.
 */
export function useGlobalShortcuts({
  onPauseToggle,
  onAdvance,
  onFailsafeFocus,
  onEmergencyFocus,
  onAnnotateFocus,
  enabled = true,
}: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Enter is a "global enter" — works even when typing.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (onAnnotateFocus) {
          e.preventDefault();
          onAnnotateFocus();
        }
        return;
      }

      if (isTypingTarget(e.target)) return;
      // Modifier-only keystrokes ignored.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.code === "Space") {
        if (onPauseToggle) {
          e.preventDefault();
          onPauseToggle();
        }
        return;
      }
      if (e.key === "ArrowRight") {
        if (onAdvance) {
          e.preventDefault();
          onAdvance();
        }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (onFailsafeFocus) {
          e.preventDefault();
          onFailsafeFocus();
        }
        return;
      }
      if (e.key === "Escape") {
        if (onEmergencyFocus) {
          onEmergencyFocus();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    onPauseToggle,
    onAdvance,
    onFailsafeFocus,
    onEmergencyFocus,
    onAnnotateFocus,
  ]);
}
