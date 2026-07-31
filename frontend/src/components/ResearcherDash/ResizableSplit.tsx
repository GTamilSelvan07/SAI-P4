import { useEffect, useRef, useState } from "react";

/**
 * Minimal resizable split layout. Renders panels with draggable handles between them.
 * Direction "horizontal" → panels arranged left-to-right, sizes are widths.
 * Direction "vertical" → panels arranged top-to-bottom, sizes are heights.
 *
 * Pass `initialSizes` as percentage array (one entry per panel, sum should equal 100).
 * Persists user-resized sizes to localStorage if `storageKey` is given.
 */
interface ResizableSplitProps {
  direction: "horizontal" | "vertical";
  children: React.ReactNode[]; // exactly N panels (no explicit separators — drawn internally)
  initialSizes: number[]; // length must equal children.length, sum = 100
  minSizes?: number[]; // per-panel minimum percent (default 5%)
  storageKey?: string;
  className?: string;
  separatorThicknessPx?: number; // default 8
}

const DEFAULT_MIN = 5;

function loadSizes(key: string | undefined, fallback: number[]): number[] {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === fallback.length && parsed.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return parsed;
    }
  } catch { /* fall through */ }
  return fallback;
}

function saveSizes(key: string | undefined, sizes: number[]): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(sizes));
  } catch { /* ignore */ }
}

export function ResizableSplit({
  direction,
  children,
  initialSizes,
  minSizes,
  storageKey,
  className = "",
  separatorThicknessPx = 8,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; startCoord: number; startSizes: number[] } | null>(null);
  const [sizes, setSizes] = useState<number[]>(() => loadSizes(storageKey, initialSizes));

  useEffect(() => {
    saveSizes(storageKey, sizes);
  }, [sizes, storageKey]);

  useEffect(() => {
    if (sizes.length !== initialSizes.length) {
      setSizes(initialSizes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSizes.length]);

  const minArr = minSizes && minSizes.length === initialSizes.length ? minSizes : initialSizes.map(() => DEFAULT_MIN);
  const isHorizontal = direction === "horizontal";

  const onSeparatorPointerDown = (separatorIndex: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const startCoord = isHorizontal ? e.clientX : e.clientY;
    dragRef.current = { index: separatorIndex, startCoord, startSizes: [...sizes] };
  };

  const onSeparatorPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const totalPx = isHorizontal ? rect.width : rect.height;
    if (totalPx <= 0) return;
    const cur = isHorizontal ? e.clientX : e.clientY;
    const dPx = cur - dragRef.current.startCoord;
    const dPct = (dPx / totalPx) * 100;
    const next = [...dragRef.current.startSizes];
    const left = dragRef.current.index;
    const right = dragRef.current.index + 1;
    let newLeft = next[left] + dPct;
    let newRight = next[right] - dPct;
    if (newLeft < minArr[left]) {
      newRight -= (minArr[left] - newLeft);
      newLeft = minArr[left];
    }
    if (newRight < minArr[right]) {
      newLeft -= (minArr[right] - newRight);
      newRight = minArr[right];
    }
    next[left] = newLeft;
    next[right] = newRight;
    setSizes(next);
  };

  const onSeparatorPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const gridTemplate = sizes.flatMap((s, i) => {
    const cell = `${Math.max(0, s)}fr`;
    if (i < sizes.length - 1) return [cell, `${separatorThicknessPx}px`];
    return [cell];
  }).join(" ");

  const containerStyle: React.CSSProperties = {
    display: "grid",
    gap: 0,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    [isHorizontal ? "gridTemplateColumns" : "gridTemplateRows"]: gridTemplate,
  };

  const cells: React.ReactNode[] = [];
  children.forEach((child, i) => {
    cells.push(
      <div key={`p-${i}`} className="min-w-0 min-h-0 overflow-hidden">
        {child}
      </div>,
    );
    if (i < children.length - 1) {
      const handleClass = isHorizontal
        ? "bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500 transition-colors cursor-col-resize relative before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-px before:bg-gray-400"
        : "bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500 transition-colors cursor-row-resize relative before:absolute before:inset-x-0 before:top-1/2 before:-translate-y-1/2 before:h-px before:bg-gray-400";
      cells.push(
        <div
          key={`sep-${i}`}
          role="separator"
          aria-orientation={isHorizontal ? "vertical" : "horizontal"}
          tabIndex={0}
          onPointerDown={onSeparatorPointerDown(i)}
          onPointerMove={onSeparatorPointerMove}
          onPointerUp={onSeparatorPointerUp}
          onPointerCancel={onSeparatorPointerUp}
          className={handleClass}
          style={{ touchAction: "none" }}
        />,
      );
    }
  });

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {cells}
    </div>
  );
}
