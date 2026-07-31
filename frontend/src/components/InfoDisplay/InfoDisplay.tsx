import { useCallback, useMemo, useRef } from "react";
import { CandidateMap, type CandidateMeta } from "./CandidateMap";
import { CandidateSelectionProvider } from "./useCandidateSelection";
import { InfoCard } from "./InfoCard";
import { ProgressTrail, type ProgressTrailItem } from "./ProgressTrail";
import { SearchGlyph, StarGlyph, EyeGlyph } from "./glyphs";

interface CandLike { id: string; name: string }

interface InfoDisplayProps {
  title?: string;
  description?: string;
  persona?: string;
  candidates?: string[] | CandLike[];
  sharedInfo: string[];
  uniqueInfo: string[];
  compact?: boolean;
}

function normalizeCandidates(input: InfoDisplayProps["candidates"]): CandidateMeta[] {
  if (!input) return [];
  return input.map((c, i) =>
    typeof c === "string"
      ? { id: String.fromCharCode(65 + i), name: c, index: i }
      : { id: c.id, name: c.name, index: i },
  );
}

export function InfoDisplay({
  title, description, persona, candidates, sharedInfo, uniqueInfo, compact = false,
}: InfoDisplayProps) {
  const meta = useMemo(() => normalizeCandidates(candidates), [candidates]);
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const setRef = useCallback(
    (id: string) => (el: HTMLLIElement | null) => {
      if (el) cardRefs.current.set(id, el);
      else cardRefs.current.delete(id);
    },
    [],
  );
  const getEl = useCallback((id: string) => cardRefs.current.get(id) ?? null, []);

  const sharedItems = sharedInfo.map((t, i) => ({ id: `s-${i}`, text: t, variant: "shared" as const }));
  const uniqueItems = uniqueInfo.map((t, i) => ({ id: `u-${i}`, text: t, variant: "unique" as const }));
  const trailItems: ProgressTrailItem[] = [...sharedItems, ...uniqueItems].map(
    ({ id, variant }) => ({ id, variant }),
  );

  return (
    <CandidateSelectionProvider>
      <div className={compact ? "space-y-3" : "space-y-5"}>
        {!compact && (title || description) && (
          <div>
            {title && <h2 className="text-xl font-bold text-gray-900 mb-1">{title}</h2>}
            {description && <p className="text-sm text-gray-600 leading-relaxed">{description}</p>}
          </div>
        )}

        {persona && (
          <section className={compact ? "bg-sky-50 rounded-xl border border-sky-200 p-3" : "bg-sky-50 rounded-2xl border border-sky-200 shadow-sm p-4"}>
            <h3 className="text-xs font-semibold text-sky-700 uppercase tracking-wider mb-1">About You</h3>
            <p className={compact ? "text-xs text-sky-900 leading-relaxed" : "text-sm text-sky-950 leading-relaxed"}>{persona}</p>
          </section>
        )}

        {meta.length > 0 && <CandidateMap candidates={meta} compact={compact} />}

        {/* Shared section */}
        <section className={compact ? "bg-white rounded-xl border border-gray-200 p-3" : "bg-white rounded-2xl border border-gray-200 shadow-sm p-5"}>
          <header className="flex items-center gap-2 mb-3">
            <SearchGlyph className="text-gray-400" size={compact ? 14 : 18} />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Shared Information</h3>
            {!compact && <span className="text-[11px] text-gray-400">Both participants have this</span>}
          </header>
          <ul className="space-y-2">
            {sharedItems.map((it, i) => (
              <InfoCard
                key={it.id}
                ref={setRef(it.id)}
                cardId={it.id}
                text={it.text}
                candidates={meta}
                variant="shared"
                bullet={`${i + 1}.`}
                delayMs={i * 40}
              />
            ))}
          </ul>
        </section>

        {/* Unique section */}
        <section className={compact ? "bg-indigo-50 rounded-xl border-2 border-indigo-200 p-3" : "bg-indigo-50 rounded-2xl border-2 border-indigo-200 shadow-sm p-5"}>
          <header className="flex items-center gap-2 mb-3">
            <StarGlyph className="text-indigo-500" size={compact ? 14 : 18} />
            <h3 className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Your Unique Information</h3>
            {!compact && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 bg-indigo-100 rounded-full px-2 py-0.5">
                <EyeGlyph size={12} />
                Private to you
              </span>
            )}
          </header>
          <ul className="space-y-2">
            {uniqueItems.map((it, i) => (
              <InfoCard
                key={it.id}
                ref={setRef(it.id)}
                cardId={it.id}
                text={it.text}
                candidates={meta}
                variant="unique"
                bullet={"★"}
                delayMs={(sharedItems.length + i) * 40}
              />
            ))}
          </ul>
        </section>

        {!compact && trailItems.length > 0 && (
          <ProgressTrail items={trailItems} getElement={getEl} />
        )}
      </div>
    </CandidateSelectionProvider>
  );
}
