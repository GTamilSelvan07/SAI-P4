/**
 * DemographicsForm — Section A intake. Submitted once per (group, role) before
 * the battery starts. UPSERT-on-submit; participants can edit until they
 * advance past the form.
 */
import { useState } from "react";

interface DemographicsValues {
  age?: number;
  gender?: string;
  first_language?: string;
  english_prof?: string;
  education?: string;
  prior_ai_xp?: string;
  voice_asst_use?: string;
}

const GENDERS = ["Woman", "Man", "Non-binary", "Prefer to self-describe", "Prefer not to say"];
const PROFICIENCIES = ["Native", "Fluent", "Advanced", "Intermediate", "Basic"];
const EDUCATION = ["High school", "Undergraduate", "Master's", "Doctoral", "Other"];
const PRIOR_AI = ["Yes", "No", "Not sure"];
const VOICE_ASST = ["Daily", "Weekly", "Monthly", "Rarely", "Never"];

export interface DemographicsFormProps {
  groupId: string;
  role: "P1" | "P2";
  onComplete: () => void;
  initialValues?: DemographicsValues;
}

export function DemographicsForm({ groupId, role, onComplete, initialValues }: DemographicsFormProps) {
  const [values, setValues] = useState<DemographicsValues>(initialValues ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const allComplete = Boolean(
    values.age && values.gender && values.first_language &&
    values.english_prof && values.education &&
    values.prior_ai_xp && values.voice_asst_use,
  );

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch(`/api/groups/${groupId}/demographics/${role}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        setError(err.detail || `submit failed ${resp.status}`);
        return;
      }
      onComplete();
    } catch (e) {
      setError(`network error: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const set = <K extends keyof DemographicsValues>(k: K, v: DemographicsValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-wide font-bold text-sky-700">D0 · demographics</div>
        <h2 className="text-lg font-semibold text-gray-900">About you</h2>
        <p className="text-sm text-gray-500">Collected once before the task conditions. ~1 minute.</p>
      </div>

      <Field label="Age (years)">
        <input
          type="number"
          min={18}
          max={120}
          value={values.age ?? ""}
          onChange={(e) => set("age", parseInt(e.target.value) || undefined)}
          className="w-32 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Field>

      <RadioField label="Gender" value={values.gender} onChange={(v) => set("gender", v)} options={GENDERS} />

      <Field label="First language">
        <input
          type="text"
          value={values.first_language ?? ""}
          onChange={(e) => set("first_language", e.target.value)}
          className="w-64 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Field>

      <RadioField label="English proficiency" value={values.english_prof}
                  onChange={(v) => set("english_prof", v)} options={PROFICIENCIES} />

      <RadioField label="Highest education completed" value={values.education}
                  onChange={(v) => set("education", v)} options={EDUCATION} />

      <RadioField label="Have you participated in research with AI assistants or chatbots before?"
                  value={values.prior_ai_xp} onChange={(v) => set("prior_ai_xp", v)} options={PRIOR_AI} />

      <RadioField label="How often do you use voice assistants (Siri, Alexa, ChatGPT voice)?"
                  value={values.voice_asst_use} onChange={(v) => set("voice_asst_use", v)} options={VOICE_ASST} />

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!allComplete || submitting}
          className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            allComplete && !submitting
              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          {submitting ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <label className="block text-sm font-medium text-gray-800 mb-2">{label}</label>
      {children}
    </div>
  );
}

function RadioField({
  label, value, onChange, options,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
              value === opt
                ? "bg-indigo-50 border-indigo-300 text-indigo-800"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </Field>
  );
}
