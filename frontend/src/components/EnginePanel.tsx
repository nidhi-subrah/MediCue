import type { SessionState } from "@shared/types";
import { pct } from "../api";
import { needLabel } from "../catalog";
import BeliefBars from "./BeliefBars";

const KIND_LABEL: Record<string, string> = {
  ask: "Ask", lookup: "Look up", consult: "Consult", escalate: "Escalate", send: "Send", tap: "Next tap",
};

/** "How SilentSignal is thinking": belief, conformal set, decision scores and the evidence trail. */
export default function EnginePanel({ s }: { s: SessionState }) {
  const d = s.last_decision;
  return (
    <aside className="engine card" aria-label="Decision engine">
      <h3>How SilentSignal is thinking</h3>
      <div className="stats">
        <div><span className="stat-value">{pct(s.p_high)}</span><span className="stat-label">P(high-risk need)</span></div>
        <div><span className="stat-value">{s.entropy.toFixed(2)}</span><span className="stat-label">uncertainty (bits)</span></div>
        <div><span className="stat-value">{s.fatigue.toFixed(1)}×</span><span className="stat-label">fatigue</span></div>
        <div><span className="stat-value">{s.taps}</span><span className="stat-label">patient inputs</span></div>
      </div>

      <BeliefBars items={s.belief} set={s.prediction_set} />
      <p className="small">
        <strong>90% prediction set:</strong> {s.prediction_set.map(needLabel).join(", ")}
      </p>
      {s.prior_reasons.length > 0 && <p className="small muted">Prior shaped by: {s.prior_reasons.join(", ")}</p>}

      {d && (
        <>
          <h4>Last decision: {KIND_LABEL[d.chosen.kind]}</h4>
          <p className="small">{d.reason}</p>
          <div className="table-wrap">
            <table className="actions">
              <thead><tr><th>Action</th><th>Value</th><th>Costs</th><th>Score</th></tr></thead>
              <tbody>
                {d.ranked.map((a) => (
                  <tr key={a.kind + a.id} className={a.id === d.chosen.id && a.kind === d.chosen.kind ? "chosen" : ""}>
                    <td>{a.label}</td>
                    <td>{a.value.toFixed(2)}</td>
                    <td>{Object.entries(a.costs).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") || "—"}</td>
                    <td>{a.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h4>Evidence trail</h4>
      <ol className="trace">
        {s.trace.map((t, i) => (
          <li key={i}>
            <span className={`trace-kind k-${t.kind}`}>{t.kind}</span> {t.label}
            <span className="muted small"> → {t.top.map((x) => `${x.label} ${pct(x.p)}`).join(", ")}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
