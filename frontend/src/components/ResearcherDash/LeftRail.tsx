import type { FlagTag } from "./AnnotationBar";

interface LeftRailProps {
  sessionId: string;
  p1Connected: boolean;
  p2Connected: boolean;
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  onAnnotate: (tag: FlagTag) => void;
  interventionCount: number;
  lastInterventionAgoSec: number | null;
}

const TAGS: { tag: FlagTag; icon: string; label: string }[] = [
  { tag: "issue", icon: "⚠", label: "Issue" },
  { tag: "interesting", icon: "★", label: "Interesting" },
  { tag: "follow-up", icon: "↻", label: "Follow-up" },
  { tag: "milestone", icon: "✓", label: "Milestone" },
];

export function LeftRail({ sessionId, p1Connected, p2Connected, preferences, decisions, onAnnotate, interventionCount, lastInterventionAgoSec }: LeftRailProps) {
  return (
    <div className="bg-white rounded-md border border-gray-200 p-2 text-xs space-y-3 w-full h-full overflow-y-auto">
      <section>
        <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Session</div>
        <div className="font-mono text-[10px] truncate">{sessionId.slice(0, 8)}…</div>
        <div className="mt-1">
          <span className={p1Connected ? "text-green-700" : "text-gray-400"}>P1 {p1Connected ? "✓" : "—"}</span>
          {" · "}
          <span className={p2Connected ? "text-green-700" : "text-gray-400"}>P2 {p2Connected ? "✓" : "—"}</span>
        </div>
      </section>
      <section>
        <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Choices</div>
        <table className="w-full text-[10px]">
          <tbody>
            <tr><td className="text-gray-500">Initial</td><td className="text-right font-bold text-blue-700">P1: {preferences.P1 ?? "—"}</td></tr>
            <tr><td></td><td className="text-right font-bold text-teal-700">P2: {preferences.P2 ?? "—"}</td></tr>
            <tr><td className="text-gray-500 pt-1">Final</td><td className="text-right font-bold text-blue-700 pt-1">P1: {decisions.P1 ?? "—"}</td></tr>
            <tr><td></td><td className="text-right font-bold text-teal-700">P2: {decisions.P2 ?? "—"}</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Annotate</div>
        <div className="space-y-1">
          {TAGS.map(({ tag, icon, label }) => (
            <button key={tag} onClick={() => onAnnotate(tag)} className="w-full text-left px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-[10px]">{icon} {label}</button>
          ))}
        </div>
      </section>
      <section>
        <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold mb-1">AI activity</div>
        <div className="text-[10px]">
          {interventionCount} intervention{interventionCount === 1 ? "" : "s"}
          {lastInterventionAgoSec != null && (<span className="text-gray-500"> · last {Math.floor(lastInterventionAgoSec)}s ago</span>)}
        </div>
      </section>
    </div>
  );
}
