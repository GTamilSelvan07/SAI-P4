import { useEffect, useState } from "react";

export interface LiveMetricsValue {
  open_discussion_seconds: number | null;
  turn_balance_ratio: number | null;
  interruption_rate_per_min: number | null;
  info_pool_coverage: {
    total: number | null;
    p1: number | null;
    p2: number | null;
  };
}

interface LiveMetricsProps {
  metrics: LiveMetricsValue | null;
  receivedAt: number | null; // unix epoch when latest update arrived
}

/**
 * Three inline tiles surfacing the live metrics tool's three cheapest values:
 * turn balance, interruption rate, info-pool coverage. Pulses briefly each
 * time a fresh `metrics_update` lands.
 */
export function LiveMetrics({ metrics, receivedAt }: LiveMetricsProps) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (receivedAt === null) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [receivedAt]);

  if (!metrics) return null;

  const balance = metrics.turn_balance_ratio;
  const interruptions = metrics.interruption_rate_per_min;
  const coverage = metrics.info_pool_coverage;

  return (
    <div
      className={`px-5 py-2 border-b border-gray-200 bg-white grid grid-cols-3 gap-2 transition-shadow ${
        pulse ? "shadow-md ring-1 ring-indigo-100" : ""
      }`}
      aria-live="polite"
    >
      <BalanceTile balance={balance} />
      <Tile
        label="Interruptions"
        value={interruptions === null ? "—" : `${interruptions.toFixed(1)}/min`}
        sub={interruptions === null
          ? "n/a"
          : interruptions > 5 ? "high" : interruptions > 2 ? "moderate" : "low"}
        tone={interruptions === null ? "neutral" : interruptions > 5 ? "warn" : "ok"}
      />
      <CoverageTile coverage={coverage} />
    </div>
  );
}

function Tile({ label, value, sub, tone = "neutral" }: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok" ? "text-green-700"
    : tone === "warn" ? "text-amber-700"
    : "text-gray-700";
  return (
    <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div className={`text-base font-bold ${toneClass}`}>{value}</div>
        <div className="text-[10px] text-gray-400">{sub}</div>
      </div>
    </div>
  );
}

function BalanceTile({ balance }: { balance: number | null }) {
  if (balance === null) {
    return <Tile label="Turn balance" value="—" sub="awaiting" />;
  }
  const p1Pct = Math.round(balance * 100);
  const p2Pct = 100 - p1Pct;
  const skew = Math.abs(0.5 - balance);
  const tone: "ok" | "warn" | "neutral" = skew > 0.25 ? "warn" : skew > 0.1 ? "neutral" : "ok";
  return (
    <div className={`rounded-md border px-3 py-1.5 ${tone === "warn" ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
        Turn balance
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-xs font-bold text-blue-600">P1 {p1Pct}%</span>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-gray-200 flex">
          <div className="h-full bg-blue-500" style={{ width: `${p1Pct}%` }} />
          <div className="h-full bg-teal-500" style={{ width: `${p2Pct}%` }} />
        </div>
        <span className="text-xs font-bold text-teal-600">P2 {p2Pct}%</span>
      </div>
    </div>
  );
}

function CoverageTile({ coverage }: { coverage: LiveMetricsValue["info_pool_coverage"] }) {
  const total = coverage.total;
  if (total === null) {
    return <Tile label="Info coverage" value="—" sub="awaiting" />;
  }
  const pct = Math.round(total * 100);
  const tone: "ok" | "warn" | "neutral" = pct >= 70 ? "ok" : pct >= 40 ? "neutral" : "warn";
  return (
    <Tile
      label="Info coverage"
      value={`${pct}%`}
      sub={
        coverage.p1 !== null && coverage.p2 !== null
          ? `P1 ${Math.round((coverage.p1 ?? 0) * 100)}% · P2 ${Math.round((coverage.p2 ?? 0) * 100)}%`
          : "by side"
      }
      tone={tone}
    />
  );
}
