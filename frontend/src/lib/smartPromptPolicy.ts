import type { TaskFull } from "../types";

/**
 * The option the C3 (anchoring) condition steers toward: the session-resolved
 * anchor if the backend supplied one, otherwise the task's default anchor.
 * Used by the researcher dashboard to display which option is being anchored.
 */
export function effectiveAnchorOption(task: TaskFull | null): string {
  return task?.session_anchor_option || task?.anchor_option || "";
}
