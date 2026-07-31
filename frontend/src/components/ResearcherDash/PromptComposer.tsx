import { useState, useMemo, useEffect } from "react";
import type { SlotMap, TaskFull, Condition, TranscriptLine } from "../../types";
import { resolveTemplate } from "../../lib/promptResolver";
import { getConditionChipConfig, lookupComposerTemplate, suggestComposerSelection } from "../../lib/composerTemplates";
import type { SmartPromptContext, ValidationResult } from "../../lib/smartPromptPolicy";
import { candidateName, preferredComposerTarget, validateSmartPrompt } from "../../lib/smartPromptPolicy";

interface PromptComposerProps {
  task: TaskFull | null;
  slots: SlotMap;
  condition: Condition | null;
  transcript?: TranscriptLine[];
  preferences?: { P1?: string; P2?: string };
  decisions?: { P1?: string; P2?: string };
  amplificationTarget?: string | null;
  policyContext: SmartPromptContext;
  onPlay: (resolved: string) => void;
  onSave: (resolved: string) => void;
}

export function PromptComposer({
  task,
  slots,
  condition,
  transcript = [],
  preferences = {},
  decisions = {},
  amplificationTarget = null,
  policyContext,
  onPlay,
  onSave,
}: PromptComposerProps) {
  const cfg = getConditionChipConfig(condition);
  const candidates = task?.candidates ?? [];

  // Pick a sensible default initial selection per condition
  const initialFraming = cfg.framings[0];
  const initialAngle = cfg.angles[0];
  const initialTarget = cfg.targetAxis === "participants"
    ? (amplificationTarget === "P1" || amplificationTarget === "P2" ? amplificationTarget : "P1")
    : preferredComposerTarget(policyContext);

  const [framing, setFraming] = useState<string>(initialFraming);
  const [target, setTarget] = useState<string>(initialTarget);
  const [angle, setAngle] = useState<string>(initialAngle);

  // Reset selections when the condition/task context changes (chip vocabularies and defaults differ).
  useEffect(() => {
    setFraming(cfg.framings[0]);
    setAngle(cfg.angles[0]);
    setTarget(cfg.targetAxis === "participants"
      ? (amplificationTarget === "P1" || amplificationTarget === "P2" ? amplificationTarget : "P1")
      : preferredComposerTarget(policyContext));
  }, [condition, task?.id, amplificationTarget]);

  // Resolve template using current chip selections
  const participantOption = cfg.targetAxis === "participants"
    ? preferences[target as "P1" | "P2"] ?? decisions[target as "P1" | "P2"] ?? ""
    : "";
  const targetName = cfg.targetAxis === "participants"
    ? candidateName(task, participantOption || preferredComposerTarget({ ...policyContext, condition: condition === "C4" ? "C2" : condition }))
    : candidateName(task, target);

  const targetSlots = useMemo<SlotMap>(() => ({
    ...slots,
    TARGET: targetName,
    TARGET_P: cfg.targetAxis === "participants" ? target : slots.TARGET_P,
    TARGET_PARTICIPANT: cfg.targetAxis === "participants" ? target : slots.TARGET_PARTICIPANT,
  }), [slots, targetName, cfg.targetAxis, target]);

  const template = lookupComposerTemplate(condition, framing, angle);
  const { resolved } = resolveTemplate(template, targetSlots);
  const validation: ValidationResult = validateSmartPrompt(resolved, policyContext);

  function handleSuggest() {
    const recentText = transcript.slice(-12).map((l) => l.text).join(" ");
    const sug = suggestComposerSelection({
      condition,
      candidates,
      preferences,
      decisions,
      amplificationTarget,
      recentText,
      policyContext,
    });
    setFraming(sug.framing);
    setTarget(sug.target);
    setAngle(sug.angle);
  }

  return (
    <div className="bg-white border-2 border-purple-300 border-dashed rounded p-2 mb-2">
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-[9px] uppercase tracking-wide text-purple-700 font-semibold">Compose new biased prompt</span>
        <div className="flex items-center gap-1">
          {condition && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold">adapted for {condition}</span>
          )}
          <button
            onClick={handleSuggest}
            className="text-[8px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold hover:bg-purple-200 border border-purple-200"
            title="Auto-pick chips from recent transcript"
          >
            ✨ Suggest
          </button>
        </div>
      </div>
      <div className="text-[9px] mb-1.5 space-y-1">
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[8px] uppercase font-semibold w-12">Framing</span>
          {cfg.framings.map((f) => (
            <button key={f} onClick={() => setFraming(f)} className={`text-[9px] px-2 py-0.5 rounded-full border ${framing === f ? "bg-purple-700 text-white border-purple-700" : "bg-purple-100 text-purple-700 border-purple-200"}`}>{f}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[8px] uppercase font-semibold w-12">Target</span>
          {cfg.targetAxis === "participants" ? (
            (["P1", "P2"] as const).map((p) => (
              <button key={p} onClick={() => setTarget(p)} className={`text-[9px] px-2 py-0.5 rounded-full border ${target === p ? "bg-purple-700 text-white border-purple-700" : "bg-purple-100 text-purple-700 border-purple-200"}`}>{p}{amplificationTarget === p ? " · target" : ""}</button>
            ))
          ) : (
            candidates.map((c) => (
              <button key={c.id} onClick={() => setTarget(c.id)} className={`text-[9px] px-2 py-0.5 rounded-full border ${target === c.id ? "bg-purple-700 text-white border-purple-700" : "bg-purple-100 text-purple-700 border-purple-200"}`}>{c.id} · {c.name}</button>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[8px] uppercase font-semibold w-12">Angle</span>
          {cfg.angles.map((a) => (
            <button key={a} onClick={() => setAngle(a)} className={`text-[9px] px-2 py-0.5 rounded-full border ${angle === a ? "bg-purple-700 text-white border-purple-700" : "bg-purple-100 text-purple-700 border-purple-200"}`}>{a}</button>
          ))}
        </div>
      </div>
      <div className="bg-purple-50 border border-purple-200 rounded px-2 py-1.5 text-[10px]">
        <div className="text-gray-500 mb-1">Resolved:</div>
        <div className="text-gray-800">{resolved || <span className="italic text-gray-400">(no template — pick framing + angle)</span>}</div>
        {!validation.ok && (
          <div className="mt-1 text-[9px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-1">
            Blocked: {validation.reason}
          </div>
        )}
        <div className="flex gap-1 mt-1.5 justify-end">
          <button onClick={() => onSave(resolved)} disabled={!resolved || !validation.ok} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Save as #11</button>
          <button onClick={() => onPlay(resolved)} disabled={!resolved || !validation.ok} className="text-[9px] px-2 py-0.5 rounded bg-purple-700 text-white font-bold hover:bg-purple-600 disabled:opacity-40">Play (live TTS)</button>
        </div>
      </div>
    </div>
  );
}
