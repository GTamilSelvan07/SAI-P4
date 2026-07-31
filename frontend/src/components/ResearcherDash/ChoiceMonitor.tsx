interface ChoiceMonitorProps {
  preferences: { P1?: string; P2?: string };
  decisions: { P1?: string; P2?: string };
}

export function ChoiceMonitor({ preferences, decisions }: ChoiceMonitorProps) {
  const prefMatch =
    preferences.P1 != null && preferences.P2 != null && preferences.P1 === preferences.P2;
  const decisionMatch =
    decisions.P1 != null && decisions.P2 != null && decisions.P1 === decisions.P2;
  const p1Drift =
    preferences.P1 != null && decisions.P1 != null && preferences.P1 !== decisions.P1;
  const p2Drift =
    preferences.P2 != null && decisions.P2 != null && preferences.P2 !== decisions.P2;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Choices</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 uppercase">
            <th className="text-left font-medium pb-1"></th>
            <th className="text-center font-medium pb-1">P1</th>
            <th className="text-center font-medium pb-1">P2</th>
            <th className="text-right font-medium pb-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-1 text-gray-600">Initial</td>
            <td className="py-1 text-center font-semibold text-blue-700">
              {preferences.P1 ?? <span className="text-gray-300">—</span>}
            </td>
            <td className="py-1 text-center font-semibold text-teal-700">
              {preferences.P2 ?? <span className="text-gray-300">—</span>}
            </td>
            <td className="py-1 text-right">
              {preferences.P1 != null && preferences.P2 != null ? (
                prefMatch ? <span className="text-green-600">{"✓"}</span> : <span className="text-amber-600">{"✗"}</span>
              ) : null}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-gray-600">Final</td>
            <td className="py-1 text-center font-semibold text-blue-700">
              {decisions.P1 ?? <span className="text-gray-300">—</span>}
              {p1Drift && <span className="ml-1 text-xs text-purple-600">{"↳ drift"}</span>}
            </td>
            <td className="py-1 text-center font-semibold text-teal-700">
              {decisions.P2 ?? <span className="text-gray-300">—</span>}
              {p2Drift && <span className="ml-1 text-xs text-purple-600">{"↳ drift"}</span>}
            </td>
            <td className="py-1 text-right">
              {decisions.P1 != null && decisions.P2 != null ? (
                decisionMatch ? <span className="text-green-600">{"✓"}</span> : <span className="text-amber-600">{"✗"}</span>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
