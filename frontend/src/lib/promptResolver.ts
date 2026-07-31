import type { SlotMap } from "../types";

export interface ResolveResult {
  resolved: string;
  filledKeys: string[];
  missingKeys: string[];
}

const SLOT_RE = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;

export function resolveTemplate(template: string, slots: SlotMap): ResolveResult {
  const filledKeys: string[] = [];
  const missingKeys: string[] = [];
  const resolved = template.replace(SLOT_RE, (match, key: string) => {
    const v = slots[key];
    if (v === undefined || v === null || v === "") {
      missingKeys.push(key);
      return match;
    }
    filledKeys.push(key);
    return v;
  });
  return { resolved, filledKeys, missingKeys };
}
