import type { SessionStatus, TaskFull } from "../../types";
import { effectiveAnchorOption } from "../../lib/smartPromptPolicy";

const CONDITION_COLORS: Record<string, string> = {
  C0: "bg-gray-100 text-gray-600",
  C1: "bg-gray-100 text-gray-600",
  C2: "bg-green-100 text-green-700",
  C3: "bg-amber-100 text-amber-700",
  C4: "bg-orange-100 text-orange-700",
  C5: "bg-purple-100 text-purple-700",
};

const CONDITION_NAMES: Record<string, string> = {
  C0: "No AI", C1: "Sham", C2: "Neutral", C3: "Anchoring", C4: "Amplification", C5: "Devil's Advocate",
};

interface SessionContextProps {
  status: SessionStatus | null;
  task: TaskFull | null;
  votes: Record<string, string>;
}

export function SessionContext({ status, task, votes }: SessionContextProps) {
  const currentCond = status?.condition ?? "";
  const anchorOption = effectiveAnchorOption(task);

  const runStatus: { label: string; color: string } = status?.session_ended
    ? { label: "Complete", color: "bg-gray-100 text-gray-700 border-gray-300" }
    : status?.phase_paused
      ? { label: "Paused", color: "bg-amber-50 text-amber-700 border-amber-300" }
      : status?.session_started
        ? { label: "Running", color: "bg-green-50 text-green-700 border-green-300" }
        : { label: "Waiting", color: "bg-gray-50 text-gray-600 border-gray-200" };

  return (
    <div className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto custom-scroll">
      {/* Task Info */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Current Task</h3>
        {task ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900 leading-snug">{task.title}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{task.description}</p>
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-2 text-xs text-sky-900 space-y-1">
              <p><span className="font-semibold">P1:</span> {task.p1_persona}</p>
              <p><span className="font-semibold">P2:</span> {task.p2_persona}</p>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {task.candidates.map((c) => {
                const isCorrect = c.id === task.correct_answer;
                const isAnchor = currentCond === "C3" && c.id === anchorOption;
                return (
                  <span
                    key={c.id}
                    className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      isCorrect
                        ? "bg-green-50 text-green-700 border-green-300"
                        : isAnchor
                          ? "bg-amber-50 text-amber-700 border-amber-300"
                          : "bg-gray-50 text-gray-600 border-gray-200"
                    }`}
                  >
                    {c.name}
                    {isCorrect && " \u2713"}
                    {isAnchor && " \u2693"}
                  </span>
                );
              })}
            </div>
            <div className="text-xs space-y-1 mt-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-500">Correct:</span>
                <span className="font-semibold text-green-700">
                  {task.candidates.find(c => c.id === task.correct_answer)?.name ?? task.correct_answer}
                </span>
              </div>
              {currentCond === "C3" && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-gray-500">Anchor:</span>
                  <span className="font-semibold text-amber-700">
                    {task.candidates.find(c => c.id === anchorOption)?.name ?? anchorOption}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No task loaded</p>
        )}
      </div>

      {/* Votes */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Votes</h3>
        <div className="space-y-1.5">
          {["P1", "P2"].map((role) => {
            const vote = votes[role];
            const isCorrect = task && vote === task.candidates.find(c => c.id === task.correct_answer)?.name;
            return (
              <div key={role} className="flex items-center gap-2">
                <span className={`text-xs font-bold ${role === "P1" ? "text-blue-600" : "text-teal-600"}`}>{role}</span>
                {vote ? (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    isCorrect ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-700"
                  }`}>
                    {vote} {isCorrect ? "\u2713" : ""}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 italic">not voted</span>
                )}
              </div>
            );
          })}
          {votes.P1 && votes.P2 && votes.P1 === votes.P2 && (() => {
            const correctName = task?.candidates.find(c => c.id === task?.correct_answer)?.name;
            const isCorrectConsensus = correctName !== undefined && votes.P1 === correctName;
            return (
              <div
                className={`text-xs font-semibold rounded px-2 py-1 mt-1 ${
                  isCorrectConsensus
                    ? "text-green-700 bg-green-50 border border-green-200"
                    : "text-amber-800 bg-amber-50 border border-amber-200"
                }`}
              >
                CONSENSUS: {votes.P1}
                {correctName !== undefined && (
                  <span className="ml-1 font-normal">
                    {isCorrectConsensus ? "— correct ✓" : "— anchored away from correct ⚠"}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Current Run */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Current Run</h3>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          {currentCond ? (
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded font-semibold text-xs ${CONDITION_COLORS[currentCond] ?? "bg-gray-100 text-gray-600"}`}>
                {currentCond}
              </span>
              <span className="text-xs font-medium text-gray-700">{CONDITION_NAMES[currentCond]}</span>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No condition</p>
          )}
          {task && (
            <p className="text-xs text-gray-600 leading-snug">{task.title}</p>
          )}
          <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${runStatus.color}`}>
            {runStatus.label}
          </span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  );
}
