import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface SelectionState {
  hoveredId: string | null;
  activeId: string | null;
  setHovered: (id: string | null) => void;
  toggleActive: (id: string) => void;
  clear: () => void;
}

const Ctx = createContext<SelectionState | null>(null);

export function CandidateSelectionProvider({ children }: { children: ReactNode }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const setHovered = useCallback((id: string | null) => setHoveredId(id), []);
  const toggleActive = useCallback((id: string) => {
    setActiveId((cur) => (cur === id ? null : id));
  }, []);
  const clear = useCallback(() => setActiveId(null), []);

  const value = useMemo(
    () => ({ hoveredId, activeId, setHovered, toggleActive, clear }),
    [hoveredId, activeId, setHovered, toggleActive, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCandidateSelection(): SelectionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCandidateSelection must be inside CandidateSelectionProvider");
  return v;
}
