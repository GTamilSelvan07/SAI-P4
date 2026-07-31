import { useTimer } from "../../hooks/useTimer";

interface TimerProps {
  remaining: number | null;
  paused: boolean | null;
}

export function Timer({ remaining, paused }: TimerProps) {
  const { display, remaining: current } = useTimer(remaining, paused);
  const isUrgent = current > 0 && current <= 10;

  return (
    <div className={`font-mono text-lg font-bold tabular-nums ${isUrgent ? "timer-urgent text-red-600" : "text-gray-900"}`}>
      {paused ? (
        <span className="text-amber-600">&#x23F8; {display}</span>
      ) : (
        <span>{display}</span>
      )}
    </div>
  );
}
