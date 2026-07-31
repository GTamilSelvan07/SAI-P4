/**
 * Shared types for scale renderers. Each renderer accepts the same shape of
 * props so BatteryRunner can swap them by responseType without per-renderer
 * special casing.
 */
import type { ScaleDef } from "../scaleRegistry";
import type { Condition } from "../../../types";

export type ResponseValue = number | string | null;

export interface ScaleRendererProps {
  scale: ScaleDef;
  /** Map of itemId → current value. Updated via onChange. */
  values: Record<string, ResponseValue>;
  onChange: (itemId: string, value: ResponseValue) => void;
  /** The condition for the current session (used for skip/only filtering). */
  condition?: Condition;
  disabled?: boolean;
}
