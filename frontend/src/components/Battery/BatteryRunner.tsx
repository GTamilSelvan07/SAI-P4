/**
 * BatteryRunner — orchestrates one phase of the questionnaire battery.
 *
 * Behaviour:
 *  1. On mount: GET the persisted, randomised progress for (group, role, phase).
 *  2. Resolve current scale from `next_scale_id`.
 *  3. Render the right scale via responseType → component dispatch.
 *  4. On "Next": validate all required items answered → POST autosave.
 *  5. After last scale: backend returns phase_complete=true; runner calls
 *     onComplete and parent shows the wait/transition view.
 *
 * Used by ParticipantIntake (intake), ParticipantPostTask (posttask),
 * ParticipantDebrief (debrief).
 */
import { useEffect, useMemo, useState } from "react";
import { getScale, REGISTRY_VERSION, visibleItems } from "./scaleRegistry";
import type { Phase, ScaleDef } from "./scaleRegistry";
import type { Condition } from "../../types";
import { LikertScale } from "./scales/LikertScale";
import { SemanticDifferentialScale } from "./scales/SemanticDifferentialScale";
import { NasaTlxScale } from "./scales/NasaTlxScale";
import { SliderScale } from "./scales/SliderScale";
import { FreeTextScale } from "./scales/FreeTextScale";
import { MultiChoiceScale } from "./scales/MultiChoiceScale";
import { JehnConflictScale } from "./scales/JehnConflictScale";
import { SAMScale } from "./scales/SAMScale";
import type { ResponseValue } from "./scales/types";

interface ProgressResponse {
  phase: string;
  ordered_scale_ids: string[];
  completed_scale_ids: string[];
  next_scale_id: string | null;
  registry_version: string;
  seed: number;
  condition?: Condition;
}

export interface BatteryRunnerProps {
  /** URL of the GET progress endpoint. */
  progressUrl: string;
  /** Function returning the URL of the POST endpoint for a given scale_id. */
  submitUrlFor: (scaleId: string) => string;
  phase: Phase;
  condition?: Condition;
  /** Called once the phase is complete (last scale POST returned phase_complete=true). */
  onComplete: () => void;
  /** Optional banner shown above the current battery phase. */
  banner?: React.ReactNode;
}

export function BatteryRunner({
  progressUrl, submitUrlFor, phase, condition, onComplete, banner,
}: BatteryRunnerProps) {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, ResponseValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [scaleStartedAt, setScaleStartedAt] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(progressUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`progress ${r.status}`))))
      .then((data: ProgressResponse) => {
        if (cancelled) return;
        if (data.registry_version !== REGISTRY_VERSION) {
          setError(
            `Registry version mismatch (server ${data.registry_version}, client ${REGISTRY_VERSION}). Reload the page.`,
          );
          return;
        }
        setProgress(data);
        setValues({});
        setScaleStartedAt(Date.now());
        if (!data.next_scale_id) {
          onComplete();
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressUrl]);

  const scale: ScaleDef | undefined = useMemo(() => {
    if (!progress?.next_scale_id) return undefined;
    return getScale(progress.next_scale_id);
  }, [progress?.next_scale_id]);

  const validation = useMemo(
    () => validateScale(scale, values, condition),
    [scale, values, condition],
  );

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading…</div>;
  }
  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }
  if (!progress || !scale) {
    return (
      <div className="p-8 text-center text-gray-500">
        No more scales — phase complete.
      </div>
    );
  }

  const stepNum = progress.completed_scale_ids.length + 1;
  const totalSteps = progress.ordered_scale_ids.length;
  const remainingSecs = sumEstimatedSeconds(
    progress.ordered_scale_ids.slice(stepNum - 1),
  );

  const onNext = async () => {
    if (!validation.ok) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        responses: stripNullValues(values),
        duration_ms: Date.now() - scaleStartedAt,
        registry_version: REGISTRY_VERSION,
      };
      if (phase !== "posttask") body.phase = phase;
      const resp = await fetch(submitUrlFor(scale.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        setError(err.detail || `submit failed ${resp.status}`);
        setSubmitting(false);
        return;
      }
      const data = await resp.json();
      if (data.phase_complete) {
        onComplete();
        return;
      }
      const next = await fetch(progressUrl).then((r) => r.json());
      setProgress(next);
      setValues({});
      setScaleStartedAt(Date.now());
    } catch (e) {
      setError(`network error: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {banner}

      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{scale.title}</h2>
          <span className="text-xs text-gray-500">
            Step {stepNum} of {totalSteps} · ~{Math.ceil(remainingSecs / 60)} min remaining
          </span>
        </div>
        <div className="h-1.5 mt-2 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all"
            style={{ width: `${((stepNum - 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <Renderer
        scale={scale}
        values={values}
        onChange={(id, v) => setValues((s) => ({ ...s, [id]: v }))}
        condition={condition}
        disabled={submitting}
      />

      {!validation.ok && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {validation.message}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!validation.ok || submitting}
          className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            validation.ok && !submitting
              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          {submitting ? "Saving…" : stepNum === totalSteps ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}

function Renderer(props: {
  scale: ScaleDef;
  values: Record<string, ResponseValue>;
  onChange: (itemId: string, value: ResponseValue) => void;
  condition?: Condition;
  disabled?: boolean;
}) {
  const { scale } = props;
  switch (scale.responseType) {
    case "likert4":
    case "likert5":
    case "likert7":
      return <LikertScale {...props} />;
    case "jehn_5pt":
      return <JehnConflictScale {...props} />;
    case "semantic_differential":
      return <SemanticDifferentialScale {...props} />;
    case "nasa_tlx":
      return <NasaTlxScale {...props} />;
    case "slider_0_100":
    case "slider_0_100_pct":
      return <SliderScale {...props} />;
    case "free_text":
      return <FreeTextScale {...props} />;
    case "multi_choice":
      return <MultiChoiceScale {...props} />;
    case "sam":
      return <SAMScale {...props} />;
    default:
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Unknown responseType: {scale.responseType}
        </div>
      );
  }
}

function validateScale(
  scale: ScaleDef | undefined,
  values: Record<string, ResponseValue>,
  condition?: Condition,
): { ok: boolean; message?: string } {
  if (!scale) return { ok: false };
  const items = visibleItems(scale, condition);
  for (const item of items) {
    const v = values[item.id];
    if (item.choices?.length === 1 && item.choices[0] === "__free_text__") {
      const text = (v as string | null) ?? "";
      if (item.minLength && text.trim().length < item.minLength) {
        return {
          ok: false,
          message: `Please enter at least ${item.minLength} characters for: "${item.text}"`,
        };
      }
      continue;
    }
    if (scale.responseType === "free_text") {
      const text = (v as string | null) ?? "";
      if (item.minLength && text.trim().length < item.minLength) {
        return {
          ok: false,
          message: `Please enter at least ${item.minLength} characters for: "${item.text}"`,
        };
      }
      continue;
    }
    if (v === undefined || v === null || v === "") {
      return { ok: false, message: `Please answer all items before continuing.` };
    }
  }
  return { ok: true };
}

function stripNullValues(values: Record<string, ResponseValue>): Record<string, ResponseValue> {
  const out: Record<string, ResponseValue> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function sumEstimatedSeconds(scaleIds: string[]): number {
  return scaleIds.reduce((sum, sid) => {
    const s = getScale(sid);
    return sum + (s?.estimatedSeconds ?? 0);
  }, 0);
}
