import { useCallback, useEffect, useState } from "react";
import type { RiskContributor, RiskFlagLevel, RiskKey, RiskOverview, RiskPatient, RiskScore } from "@shared/types";
import { api, pct } from "../api";
import Icon from "../components/Icon";

export const RISKS: { key: RiskKey; short: string }[] = [
  { key: "fall", short: "Fall" },
  { key: "dehydration", short: "Dehydration" },
  { key: "delirium", short: "Delirium/infection" },
];

const LEVEL: Record<RiskFlagLevel, { label: string; icon: string; rank: number }> = {
  low: { label: "Low", icon: "level_low", rank: 0 },
  watch: { label: "Watch", icon: "level_watch", rank: 1 },
  elevated: { label: "Elevated", icon: "level_elevated", rank: 2 },
};

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

/** Level as shape + word; colour only reinforces it. */
export function LevelBadge({ level, enough = true }: { level: RiskFlagLevel; enough?: boolean }) {
  return (
    <span className={`level level-${level}`}>
      <Icon name={LEVEL[level].icon} size={16} />
      {LEVEL[level].label}
      {!enough && <span className="level-note"> · data gap</span>}
    </span>
  );
}

/** Highest score per 6 h over 7 days, 0-100% scale, with the watch and elevated thresholds dashed. */
function RiskSpark({ values, thresholds, label }: {
  values: number[]; thresholds: { watch: number; elevated: number }; label: string;
}) {
  const W = 120, H = 30, P = 3;
  if (values.length < 2) return <span className="risk-spark-empty">no trend yet</span>;
  const x = (i: number) => P + (i * (W - 2 * P)) / (values.length - 1);
  const y = (v: number) => H - P - v * (H - 2 * P);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values[values.length - 1];
  const summary = `${label}, last 7 days: from ${pct(values[0])} to ${pct(last)}, highest ${pct(Math.max(...values))}`;
  return (
    <svg className="risk-spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={summary}
         preserveAspectRatio="none">
      <line className="risk-spark-thr" x1={P} x2={W - P} y1={y(thresholds.watch)} y2={y(thresholds.watch)} />
      <line className="risk-spark-thr" x1={P} x2={W - P} y1={y(thresholds.elevated)} y2={y(thresholds.elevated)} />
      <path className="risk-spark-line" d={d} vectorEffect="non-scaling-stroke" />
      <circle className="risk-spark-last" cx={x(values.length - 1)} cy={y(last)} r={2.5} />
    </svg>
  );
}

function RiskChip({ short, s }: { short: string; s: RiskScore }) {
  return (
    <div className={`risk-chip risk-chip-${s.level}`}>
      <div className="risk-chip-head">
        <span className="risk-chip-name">{short}</span>
        <span className="risk-chip-score">{pct(s.score)}</span>
      </div>
      <LevelBadge level={s.level} enough={s.enough_data} />
      <RiskSpark values={s.spark ?? []} thresholds={s.thresholds} label={`${s.label} score`} />
    </div>
  );
}

function Contributor({ c }: { c: RiskContributor }) {
  return (
    <li className="why-item">
      <span className="why-signal">{c.label}</span>
      <span className="why-dir">{ARROW[c.direction]} {c.direction}</span>
      <span className="why-text">{c.text}</span>
      <span className="why-z">{Math.abs(c.z).toFixed(1)} SD</span>
    </li>
  );
}

function RiskRow({ p }: { p: RiskPatient }) {
  const scores = RISKS.flatMap((r) => (p.risks[r.key] ? [{ ...r, s: p.risks[r.key] as RiskScore }] : []));
  const byConcern = [...scores].sort((a, b) => LEVEL[b.s.level].rank - LEVEL[a.s.level].rank || b.s.score - a.s.score);
  return (
    <article className="risk-row" aria-label={`Risk for ${p.name}`}>
      <header className="trend-head">
        <span className="alert-room">{p.room}</span>
        <span className="alert-name">{p.name}</span>
        {p.synthetic && <span className="tag-synthetic">Synthetic</span>}
      </header>
      <div className="risk-chips">
        {scores.map(({ key, short, s }) => <RiskChip key={key} short={short} s={s} />)}
      </div>
      <details className="risk-why">
        <summary>Why</summary>
        {byConcern.map(({ key, s }) => (
          <section key={key} className="why-risk">
            <h3 className="why-title"><LevelBadge level={s.level} enough={s.enough_data} /> {s.label} · {pct(s.score)}</h3>
            {s.top.length > 0 ? (
              <ul className="why-list">{s.top.map((c) => <Contributor key={c.signal} c={c} />)}</ul>
            ) : (
              <p className="why-none">Every signal is within this patient's usual range.</p>
            )}
            {s.missing.length > 0 && (
              <p className="why-none">Not enough data: {s.missing.map((m) => m.label.toLowerCase()).join(", ")}.</p>
            )}
          </section>
        ))}
        <p className="fineprint">
          Each signal is compared with this patient's own previous 7 days (SD = standard deviations from usual).
          Flags are prompts for clinician review, not diagnoses.
        </p>
      </details>
    </article>
  );
}

export default function RiskPanel() {
  const [data, setData] = useState<RiskOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCalm, setShowCalm] = useState(false);

  const load = useCallback(() => {
    api.get<RiskOverview>("/api/risk/patients").then(setData).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 5 * 60000);
    return () => window.clearInterval(t);
  }, [load]);

  const rank = (p: RiskPatient) =>
    Math.max(0, ...Object.values(p.risks).flatMap((s) => (s ? [LEVEL[s.level].rank] : [])));
  const patients = data?.patients ?? [];
  const concerning = patients.filter((p) => rank(p) > 0);
  const calm = patients.filter((p) => rank(p) === 0);

  return (
    <section className="risk-panel" aria-labelledby="risk-h">
      <header className="section-head">
        <h2 id="risk-h">Risk</h2>
        <p className="section-meta">
          <span className="tag-synthetic">Synthetic data</span>{" "}
          {data && `${concerning.length} on watch or elevated`}
        </p>
      </header>
      {error && <p className="error">{error}</p>}
      {data && <p className="risk-notice">{data.notice}</p>}
      {data && concerning.length === 0 && <p className="empty">No patient is on watch or elevated.</p>}
      {concerning.map((p) => <RiskRow key={p.patient_id} p={p} />)}
      {calm.length > 0 && (
        <button className="text-btn" onClick={() => setShowCalm(!showCalm)} aria-expanded={showCalm}>
          {showCalm ? "Hide" : "Show"} {calm.length} patients with every risk low
        </button>
      )}
      {showCalm && calm.map((p) => <RiskRow key={p.patient_id} p={p} />)}
    </section>
  );
}
