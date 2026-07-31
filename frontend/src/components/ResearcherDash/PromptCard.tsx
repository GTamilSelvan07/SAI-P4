import type { Relevance } from "../../lib/promptRanking";
import type { PromptCardData } from "../../types";

interface PromptCardProps {
  data: PromptCardData & { relevance: Relevance; reason: string };
  onPlay: (id: string, editedText?: string) => void;
  onEdit: (id: string) => void;
  onCancelEdit: (id: string) => void;
  onDraftChange: (id: string, text: string) => void;
  edited: boolean;
  editing: boolean;
  draft: string;
}

const RELEVANCE_PILL: Record<Relevance, string> = {
  HIGH: "bg-green-100 text-green-800",
  MED: "bg-amber-100 text-amber-800",
  LOW: "bg-gray-100 text-gray-500",
};

export function PromptCard({ data, onPlay, onEdit, onCancelEdit, onDraftChange, edited, editing, draft }: PromptCardProps) {
  const cardClass = data.played ? "bg-white border-gray-200 opacity-55" : data.relevance === "HIGH" ? "bg-white border-green-400 ring-2 ring-green-100" : "bg-white border-gray-200";
  const playText = editing ? draft : edited ? draft : undefined;
  return (
    <div className={`border rounded p-1.5 mb-1.5 ${cardClass}`}>
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className={`text-[8px] font-bold px-1 rounded ${RELEVANCE_PILL[data.relevance]}`}>
          {data.relevance === "HIGH" ? "↑ HIGH" : data.relevance} · {data.reason}
        </span>
        <span className="text-[8px] text-gray-500">#{data.archetype ?? "?"}</span>
      </div>
      <div className="text-[10px] font-bold">{data.title}</div>
      {data.template && (<div className="text-[9px] text-gray-500 font-mono mt-1 leading-tight">{data.template}</div>)}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(data.id, e.target.value)}
          rows={3}
          className="w-full text-[10px] text-gray-800 mt-1 bg-white rounded px-1.5 py-1 border border-indigo-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
        />
      ) : (
        <div className="text-[10px] text-gray-800 mt-1 bg-gray-50 rounded px-1.5 py-1">{edited ? draft : data.resolved}</div>
      )}
      <div className="flex gap-1 justify-end mt-1.5">
        {editing ? (
          <button onClick={() => onCancelEdit(data.id)} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50">Cancel</button>
        ) : (
          <button onClick={() => onEdit(data.id)} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
        )}
        <button onClick={() => onPlay(data.id, playText)} disabled={editing && !draft.trim()} className="text-[9px] px-2 py-0.5 rounded bg-indigo-600 text-white font-bold hover:bg-indigo-500 disabled:opacity-40">
          {data.played ? "Replay" : edited || editing ? "Play edited" : "Play cached"}
        </button>
      </div>
    </div>
  );
}
