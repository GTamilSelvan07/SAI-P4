import { useEffect, useState } from "react";

export interface ProgressTrailItem {
  id: string;
  variant: "shared" | "unique";
}

interface Props {
  items: ProgressTrailItem[];
  getElement: (id: string) => HTMLElement | null;
}

export function ProgressTrail({ items, getElement }: Props) {
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (items.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        setSeen((prev) => {
          let next = prev;
          for (const e of entries) {
            if (e.isIntersecting) {
              const id = (e.target as HTMLElement).getAttribute("data-card-id");
              if (id && !prev.has(id)) {
                if (next === prev) next = new Set(prev);
                next.add(id);
              }
            }
          }
          return next;
        });
      },
      { threshold: 0.5 },
    );
    for (const item of items) {
      const el = getElement(item.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [items, getElement]);

  if (items.length === 0) return null;

  return (
    <div className="sticky bottom-0 backdrop-blur bg-gray-50/80 pt-3 pb-2 -mx-1 px-1 rounded-t-lg">
      <div className="flex items-center justify-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-2">read</span>
        {items.map((item) => {
          const filled = seen.has(item.id);
          const fillCol = item.variant === "unique" ? "bg-indigo-500" : "bg-slate-500";
          const emptyCol = item.variant === "unique" ? "bg-indigo-100" : "bg-gray-200";
          return (
            <span
              key={item.id}
              className={`h-1.5 w-4 rounded-full transition-all duration-300 ${filled ? fillCol : emptyCol}`}
            />
          );
        })}
        <span className="text-[10px] tabular-nums text-gray-400 ml-2">
          {seen.size}/{items.length}
        </span>
      </div>
    </div>
  );
}
