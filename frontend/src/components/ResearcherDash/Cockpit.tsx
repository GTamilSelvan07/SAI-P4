import { useEffect, useState } from "react";
import type { SessionStatus, TranscriptLine, AIIntervention, TaskFull } from "../../types";
import type { FlagTag } from "./AnnotationBar";
import { TopContextStrip } from "./TopContextStrip";
import { LeftRail } from "./LeftRail";
import { LiveTranscriptPanel } from "./LiveTranscriptPanel";
import { BottomActionBar } from "./BottomActionBar";
import { ResizableSplit } from "./ResizableSplit";
import { RecordingIndicator } from "./RecordingIndicator";
import { AIPanel, type FacilitatorState } from "./AIPanel";
import { LiveMetrics, type LiveMetricsValue } from "./LiveMetrics";
import { effectiveAnchorOption } from "../../lib/smartPromptPolicy";

function useNarrowViewport(thresholdPx = 1024): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth < thresholdPx);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setNarrow(window.innerWidth < thresholdPx);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [thresholdPx]);
  return narrow;
}

interface CockpitProps {
  sessionId: string;
  status: SessionStatus | null;
  transcript: TranscriptLine[];
  interventions: AIIntervention[];
  task: TaskFull | null;
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
  currentSpeaker: "P1" | "P2" | null;
  connectedRoles: string[];
  conditionLabel?: string;
  conditionColor?: string;
  paused: boolean;
  facilitator: FacilitatorState | null;
  sessionStartedAt: number | null;
  liveMetrics: LiveMetricsValue | null;
  liveMetricsAt: number | null;
  onAdvance: () => void;
  onPause: () => void;
  onFailsafe: () => void;
  onEmergencyStop: () => void;
  onAnnotate: (tag: FlagTag) => void;
  playFailsafe: (category: string, text: string) => void;
}

export function Cockpit(props: CockpitProps) {
  const anchorOption = effectiveAnchorOption(props.task) || null;
  const anchorName = anchorOption && props.task?.candidates ? (props.task.candidates.find((c) => c.id === anchorOption)?.name ?? null) : null;
  const narrow = useNarrowViewport(1024);
  const isOpenDiscussion = props.status?.phase === "open_discussion";

  const aiPanel = (
    <AIPanel
      status={props.status}
      facilitator={props.facilitator}
      interventions={props.interventions}
      sessionStartedAt={props.sessionStartedAt}
      playFailsafe={props.playFailsafe}
    />
  );

  // Narrow viewports: stacked, scrollable column layout (no resize handles)
  if (narrow) {
    return (
      <div className="space-y-2 p-2 min-h-screen flex flex-col">
        <TopContextStrip
          status={props.status}
          conditionLabel={props.conditionLabel}
          conditionColor={props.conditionColor}
          taskTitle={props.task?.title}
          anchorOption={anchorOption}
          anchorName={anchorName}
          currentSpeaker={props.currentSpeaker}
        />
        <div className="flex items-center justify-end rounded-md border border-gray-200 bg-white px-3 py-1">
          <RecordingIndicator sessionId={props.sessionId} />
        </div>
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          <div className="min-h-[140px]">
            <LeftRail
              sessionId={props.sessionId}
              p1Connected={props.connectedRoles.includes("P1")}
              p2Connected={props.connectedRoles.includes("P2")}
              preferences={props.preferences}
              decisions={props.decisions}
              onAnnotate={props.onAnnotate}
              interventionCount={props.interventions.length}
              lastInterventionAgoSec={props.interventions.length > 0 ? (Date.now() / 1000 - props.interventions[props.interventions.length - 1].ts) : null}
            />
          </div>
          {isOpenDiscussion && <LiveMetrics metrics={props.liveMetrics} receivedAt={props.liveMetricsAt} />}
          <div className="bg-gray-50 rounded-md border border-gray-200 p-2 overflow-y-auto min-h-[140px]">
            <LiveTranscriptPanel transcript={props.transcript} maxHeight="200px" />
          </div>
          <div className="min-h-[240px] overflow-y-auto">
            {aiPanel}
          </div>
        </div>
        <BottomActionBar
          onAdvance={props.onAdvance}
          onPause={props.onPause}
          onFailsafe={props.onFailsafe}
          onEmergencyStop={props.onEmergencyStop}
          paused={props.paused}
        />
      </div>
    );
  }

  return (
    <div className="p-2 h-screen min-h-0">
      <ResizableSplit
        direction="vertical"
        initialSizes={[14, 74, 12]}
        minSizes={[9, 45, 8]}
        storageKey="cockpit-study-rows"
        className="h-full w-full"
      >
        <div className="h-full min-h-0 overflow-y-auto space-y-2 pr-1">
          <TopContextStrip
            status={props.status}
            conditionLabel={props.conditionLabel}
            conditionColor={props.conditionColor}
            taskTitle={props.task?.title}
            anchorOption={anchorOption}
            anchorName={anchorName}
            currentSpeaker={props.currentSpeaker}
          />
          <div className="flex items-center justify-end rounded-md border border-gray-200 bg-white px-3 py-1">
            <RecordingIndicator sessionId={props.sessionId} />
          </div>
        </div>

        <ResizableSplit
          direction="horizontal"
          initialSizes={[15, 55, 30]}
          minSizes={[10, 30, 20]}
          storageKey="cockpit-cols"
          className="h-full w-full"
        >
          {/* LEFT */}
          <LeftRail
            sessionId={props.sessionId}
            p1Connected={props.connectedRoles.includes("P1")}
            p2Connected={props.connectedRoles.includes("P2")}
            preferences={props.preferences}
            decisions={props.decisions}
            onAnnotate={props.onAnnotate}
            interventionCount={props.interventions.length}
            lastInterventionAgoSec={props.interventions.length > 0 ? (Date.now() / 1000 - props.interventions[props.interventions.length - 1].ts) : null}
          />

          {/* CENTER: live metrics (open discussion only) + transcript */}
          <div className="bg-gray-50 rounded-md border border-gray-200 p-2 overflow-y-auto h-full w-full">
            {isOpenDiscussion && <LiveMetrics metrics={props.liveMetrics} receivedAt={props.liveMetricsAt} />}
            <LiveTranscriptPanel transcript={props.transcript} maxHeight="100%" />
          </div>

          {/* RIGHT: live AI facilitator panel */}
          <div className="h-full w-full overflow-y-auto">
            {aiPanel}
          </div>
        </ResizableSplit>

        <div className="h-full min-h-0 overflow-y-auto">
          <BottomActionBar
            onAdvance={props.onAdvance}
            onPause={props.onPause}
            onFailsafe={props.onFailsafe}
            onEmergencyStop={props.onEmergencyStop}
            paused={props.paused}
          />
        </div>
      </ResizableSplit>
    </div>
  );
}
