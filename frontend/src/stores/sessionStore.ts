import { create } from "zustand";
import type { SessionStatus, TranscriptLine, AICaption } from "../types";

interface SessionStore {
  sessionId: string | null;
  status: SessionStatus | null;
  transcript: TranscriptLine[];
  participantTranscript: TranscriptLine[];
  aiCaption: AICaption | null;
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  connectedRoles: string[];
  useCockpitV3: boolean;
  currentSpeaker: "P1" | "P2" | null;
  lastMentionedCandidate: string | null;
  editedPromptIds: Set<string>;

  setSessionId: (id: string) => void;
  setStatus: (status: SessionStatus) => void;
  addTranscriptLine: (line: TranscriptLine) => void;
  addParticipantTranscriptLine: (line: TranscriptLine) => void;
  setAICaption: (cap: AICaption | null) => void;
  setPreference: (role: "P1" | "P2", choice: string) => void;
  setDecision: (role: "P1" | "P2", choice: string) => void;
  resetChoices: () => void;
  setConnectedRoles: (roles: string[]) => void;
  setUseCockpitV3: (v: boolean) => void;
  setCurrentSpeaker: (role: "P1" | "P2" | null) => void;
  setLastMentionedCandidate: (name: string | null) => void;
  markPromptEdited: (id: string) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: null,
  status: null,
  transcript: [],
  participantTranscript: [],
  aiCaption: null,
  preferences: {},
  decisions: {},
  connectedRoles: [],
  useCockpitV3: true,
  currentSpeaker: null,
  lastMentionedCandidate: null,
  editedPromptIds: new Set(),

  setSessionId: (id) => set({ sessionId: id }),
  setStatus: (status) => set({ status }),
  addTranscriptLine: (line) =>
    set((state) => ({ transcript: [...state.transcript, line] })),
  addParticipantTranscriptLine: (line) =>
    set((state) => ({ participantTranscript: [...state.participantTranscript, line] })),
  setAICaption: (cap) => set({ aiCaption: cap }),
  setPreference: (role, choice) =>
    set((state) => ({ preferences: { ...state.preferences, [role]: choice } })),
  setDecision: (role, choice) =>
    set((state) => ({ decisions: { ...state.decisions, [role]: choice } })),
  resetChoices: () => set({ preferences: {}, decisions: {} }),
  setConnectedRoles: (roles) => set({ connectedRoles: roles }),
  setUseCockpitV3: (v) => set({ useCockpitV3: v }),
  setCurrentSpeaker: (role) => set({ currentSpeaker: role }),
  setLastMentionedCandidate: (name) => set({ lastMentionedCandidate: name }),
  markPromptEdited: (id) =>
    set((state) => {
      const next = new Set(state.editedPromptIds);
      next.add(id);
      return { editedPromptIds: next };
    }),
  reset: () =>
    set({
      sessionId: null,
      status: null,
      transcript: [],
      participantTranscript: [],
      aiCaption: null,
      preferences: {},
      decisions: {},
      connectedRoles: [],
      useCockpitV3: true,
      currentSpeaker: null,
      lastMentionedCandidate: null,
      editedPromptIds: new Set(),
    }),
}));
