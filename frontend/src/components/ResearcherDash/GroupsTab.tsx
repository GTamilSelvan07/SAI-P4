/**
 * GroupsTab — researcher home: list questionnaire dyads, create new, drill into detail.
 *
 * A "group" is a P1+P2 dyad that completes intake once and then runs N
 * sessions. Status flow: pending → ready → active → completed (or aborted).
 * "Create new group" yields shareable join URLs; the dyad does intake from
 * those URLs without the researcher's involvement.
 */
import { useEffect, useState } from "react";

interface GroupSnapshot {
  group_id: string;
  status: string;
  created_at: number;
  p1_label: string | null;
  p2_label: string | null;
  p1_intake_done: boolean;
  p2_intake_done: boolean;
  p1_intake_done_at: string | null;
  p2_intake_done_at: string | null;
  p1_debrief_done_at: string | null;
  p2_debrief_done_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  session_ids: string[];
  last_active_session_id: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  ready: "bg-green-50 text-green-800 border-green-200",
  active: "bg-blue-50 text-blue-800 border-blue-200",
  completed: "bg-gray-50 text-gray-700 border-gray-200",
  aborted: "bg-red-50 text-red-700 border-red-200",
};

export interface GroupsTabProps {
  onOpenGroup: (groupId: string) => void;
  onBack: () => void;
}

export function GroupsTab({ onOpenGroup, onBack }: GroupsTabProps) {
  const [groups, setGroups] = useState<GroupSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ p1_label: "", p2_label: "", notes: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "ready" | "active" | "completed">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const url = filter === "all" ? "/api/groups" : `/api/groups?status=${filter}`;
      const r = await fetch(url);
      if (r.ok) setGroups(await r.json());
    } catch (e) {
      setError(`refresh failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const r = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p1_label: createForm.p1_label || undefined,
          p2_label: createForm.p2_label || undefined,
          notes: createForm.notes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        setError(err.detail || `create failed ${r.status}`);
        return;
      }
      setShowCreate(false);
      setCreateForm({ p1_label: "", p2_label: "", notes: "" });
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!confirm(`Delete questionnaire record ${groupId}? This is only allowed before any sessions are created.`)) return;
    setDeletingId(groupId);
    setError("");
    try {
      const r = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        setError(err.detail || `delete failed ${r.status}`);
        return;
      }
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Questionnaire</h1>
            <p className="text-sm text-gray-500">Participant dyads — intake questionnaires → sessions → debrief.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">← Back</button>
            <button
              onClick={() => setShowCreate((s) => !s)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm"
            >
              + Create questionnaire
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">New questionnaire dyad</h3>
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label="P1 label (optional)" value={createForm.p1_label}
                            onChange={(v) => setCreateForm((s) => ({ ...s, p1_label: v }))} />
              <LabeledInput label="P2 label (optional)" value={createForm.p2_label}
                            onChange={(v) => setCreateForm((s) => ({ ...s, p2_label: v }))} />
            </div>
            <LabeledInput label="Notes (optional)" value={createForm.notes}
                          onChange={(v) => setCreateForm((s) => ({ ...s, notes: v }))} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
              <button
                onClick={create}
                disabled={creating}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 text-xs">
          {(["all", "pending", "ready", "active", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full border ${
                filter === f
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500 text-sm">
            No groups in this filter.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Questionnaire ID</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">D0 Intake</th>
                  <th className="px-4 py-2 text-left">Sessions</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.group_id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{g.group_id}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_BADGE[g.status] ?? "bg-gray-50 border-gray-200"}`}>
                        {g.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-700">
                      <span className="font-mono font-semibold text-sky-700">D0</span>{" "}
                      P1 {g.p1_intake_done ? "✓" : "…"} · P2 {g.p2_intake_done ? "✓" : "…"}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-700">{g.session_ids.length}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{relTime(g.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      {g.session_ids.length === 0 && (
                        <button
                          onClick={() => deleteGroup(g.group_id)}
                          disabled={deletingId === g.group_id}
                          className="mr-3 text-red-600 hover:text-red-800 text-sm font-medium disabled:text-gray-400"
                        >
                          {deletingId === g.group_id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                      <button
                        onClick={() => onOpenGroup(g.group_id)}
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                      >
                        Detail →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

function relTime(ts: number): string {
  const secs = Math.max(0, Date.now() / 1000 - ts);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}
