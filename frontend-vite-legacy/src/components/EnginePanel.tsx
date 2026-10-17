import type { SessionState } from "@shared/types";
import { pct } from "../api";
import { needLabel } from "../catalog";
import BeliefBars from "./BeliefBars";
import ProfileList from "./ProfileList";

const KIND_LABEL: Record<string, string> = {
  ask: "Ask", lookup: "Look up", consult: "Consult", escalate: "Escalate", send: "Send", tap: "Next tap",
};

/** The decision engine's live state: belief, conformal set, decision scores and the evidence trail. */
export default function EnginePanel({ s }: { s: SessionState }) {
  const d = s.last_decision;
  return (
    <aside className="engine" aria-label="Decision engine">
      <h2 className="engine-title">Engine</h2>
      <dl className="readout">
        <div><dt>High-risk</dt><dd className={s.p_high >= 0.25 ? "hot" : ""}>{pct(s.p_high)}</dd></div>
        <div><dt>Uncertainty</dt><dd>{s.entropy.toFixed(2)}<small> bits</small></dd></div>
        <div><dt>Fatigue</dt><dd>{s.fatigue.toFixed(1)}<small>×</small></dd></div>
        <div><dt>Inputs</dt><dd>{s.taps}</dd></div>
      </dl>

      <section>
        <h3>Belief</h3>
        <BeliefBars items={s.belief} set={s.prediction_set} />
        <p className="engine-note">90% set: {s.prediction_set.map(needLabel).join(", ")}</p>
        {s.prior_reasons.length > 0 && <p className="engine-note">Prior shaped by {s.prior_reasons.join(", ")}</p>}
      </section>

      <section>
        <h3>Patient profile</h3>
        <ProfileList items={s.profile} empty="No profile (Gemini off or nothing in the notes)." />
        <p className="engine-note">
          {s.baseline_interval ? `Usual pace ${s.baseline_interval.toFixed(1)} s between inputs` : "No personal pace baseline yet"}
          {s.inconsistencies > 0 && ` · ${s.inconsistencies} inconsistent answer${s.inconsistencies === 1 ? "" : "s"}`}
        </p>
      </section>

      {d && (
        <section>
          <h3>Decision: {KIND_LABEL[d.chosen.kind]}</h3>
          <p className="engine-note">{d.reason}</p>
          <div className="table-wrap">
            <table className="scores">
              <thead><tr><th>Action</th><th>Value</th><th>Cost</th><th>Score</th></tr></thead>
              <tbody>
                {d.ranked.map((a) => (
                  <tr key={a.kind + a.id} className={a.id === d.chosen.id && a.kind === d.chosen.kind ? "chosen" : ""}>
                    <td>{a.label}</td>
                    <td>{a.value.toFixed(2)}</td>
                    <td title={Object.entries(a.costs).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}>
                      {Object.values(a.costs).reduce((x, y) => x + y, 0).toFixed(2)}
                    </td>
                    <td>{a.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h3>Evidence</h3>
        <ol className="trace">
          {s.trace.map((t, i) => (
            <li key={i}>
              <span className="trace-kind">{t.kind}</span>
              <span>{t.label}</span>
              <span className="trace-top">{t.top.slice(0, 2).map((x) => `${x.label} ${pct(x.p)}`).join(" · ")}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
