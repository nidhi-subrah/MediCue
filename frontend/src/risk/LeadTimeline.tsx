import { useEffect, useMemo, useState } from "react";
import type { Timeline, TimelineCase } from "@shared/types";
import { api, pct } from "../api";
import { LevelBadge } from "./RiskPanel";

const W = 880;          // drawing units; the SVG scales to its container
const LEFT = 8, RIGHT = 120;
const MARKS = 64;       // marker labels above the tracks
const SCORE_H = 110;
const SIG_H = 58;
const AXIS_H = 28;
const Z_MIN = -2, Z_MAX = 4;

const SPLIT = { train: "training", test: "held-out" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function chooseDefault(cases: TimelineCase[]): string | null {
  const falls = cases.filter((c) => c.risk === "fall" && c.lead_days !== null)
    .sort((a, b) => (b.lead_days ?? 0) - (a.lead_days ?? 0));
  return (falls[0] ?? cases[0])?.patient_id ?? null;
}

/** Signals drifting, the moment the flag fired and the outcome, for one synthetic storyline. */
function Chart({ t }: { t: Timeline }) {
  const t0 = new Date(t.series[0].time).getTime();
  const t1 = new Date(t.outcome.time).getTime() + 3 * 3600e3;
  const x = (iso: string) => LEFT + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - LEFT - RIGHT);
  const H = MARKS + SCORE_H + t.signals.length * SIG_H + AXIS_H;
  const scoreTop = MARKS;
  const ys = (v: number) => scoreTop + 10 + (1 - v) * (SCORE_H - 24);
  const sigTop = (i: number) => MARKS + SCORE_H + i * SIG_H;
  const yz = (i: number, z: number) =>
    sigTop(i) + 18 + (1 - (Math.min(Math.max(z, Z_MIN), Z_MAX) - Z_MIN) / (Z_MAX - Z_MIN)) * (SIG_H - 26);

  const line = (pts: [number, number | null][]) => pts.reduce((acc, [px, py], i) => {
    if (py === null) return acc;
    return acc + `${acc && pts[i - 1]?.[1] !== null ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
  }, "");

  const ticks = useMemo(() => {
    const out: string[] = [];
    const d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    for (d.setDate(d.getDate() + 1); d.getTime() < t1; d.setDate(d.getDate() + 1)) out.push(d.toISOString());
    return out;
  }, [t0, t1]);

  const xOnset = x(t.outcome.onset), xOut = x(t.outcome.time);
  const xFlag = t.flag ? x(t.flag.time) : null;
  const bottom = H - AXIS_H;
  const word = t.headline.replace(/^.*synthetic /, "synthetic ");

  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label={`${t.headline}. Risk score and the signals behind it over the week before the event.`}>
      {/* markers */}
      {xOnset > LEFT && (
        <g className="tl-mark tl-onset">
          <line x1={xOnset} x2={xOnset} y1={46} y2={bottom} />
          <text x={xOnset + 4} y={58}>Storyline begins (synthetic label)</text>
        </g>
      )}
      {xFlag !== null && t.flag && (
        <g className="tl-mark tl-flag">
          <line x1={xFlag} x2={xFlag} y1={28} y2={bottom} />
          <text x={xFlag + 4} y={40}>{t.flag.level === "elevated" ? "Elevated" : "Watch"} flag fired · {when(t.flag.time)}</text>
          <line className="tl-lead" x1={xFlag} x2={xOut} y1={bottom - 6} y2={bottom - 6} />
          <text className="tl-lead-text" x={(xFlag + xOut) / 2} y={bottom - 11} textAnchor="middle">
            {t.lead_days?.toFixed(1)} days
          </text>
        </g>
      )}
      <g className="tl-mark tl-outcome">
        <line x1={xOut} x2={xOut} y1={10} y2={bottom} />
        <text x={xOut - 4} y={22} textAnchor="end">{word.charAt(0).toUpperCase() + word.slice(1)}</text>
      </g>

      {/* score */}
      <text className="tl-track" x={LEFT} y={scoreTop + 4}>{t.label} score</text>
      {(["watch", "elevated"] as const).map((k) => (
        <g key={k} className="tl-thr">
          <line x1={LEFT} x2={W - RIGHT} y1={ys(t.thresholds[k])} y2={ys(t.thresholds[k])} />
          <text x={W - RIGHT + 6} y={ys(t.thresholds[k]) + 4}>{k === "watch" ? "Watch" : "Elevated"} {pct(t.thresholds[k])}</text>
        </g>
      ))}
      <path className="tl-score" d={line(t.series.map((p) => [x(p.time), ys(p.score)]))} />

      {/* signals */}
      {t.signals.map((s, i) => (
        <g key={s.key}>
          <line className="tl-sep" x1={LEFT} x2={W - RIGHT} y1={sigTop(i)} y2={sigTop(i)} />
          <text className="tl-track" x={LEFT} y={sigTop(i) + 14}>{s.label} · SD from usual, toward risk ({s.risky})</text>
          <line className="tl-zero" x1={LEFT} x2={W - RIGHT} y1={yz(i, 0)} y2={yz(i, 0)} />
          <text className="tl-axis" x={W - RIGHT + 6} y={yz(i, 0) + 4}>usual</text>
          <text className="tl-axis" x={W - RIGHT + 6} y={yz(i, 3) + 4}>+3 SD</text>
          <path className="tl-signal" d={line(t.series.map((p) => [x(p.time), p.z[s.key] == null ? null : yz(i, p.z[s.key] as number)]))} />
        </g>
      ))}

      {/* time axis */}
      {ticks.map((iso) => (
        <g key={iso} className="tl-tick">
          <line x1={x(iso)} x2={x(iso)} y1={bottom} y2={bottom + 5} />
          <text x={x(iso) + 3} y={bottom + 18}>{day(iso)}</text>
        </g>
      ))}
    </svg>
  );
}

export default function LeadTimeline() {
  const [cases, setCases] = useState<TimelineCase[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [t, setT] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ cases: TimelineCase[] }>("/api/risk/timeline")
      .then((r) => { setCases(r.cases); setPid(chooseDefault(r.cases)); })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (pid) api.get<Timeline>(`/api/risk/timeline/${pid}`).then(setT).catch((e) => setError(String(e)));
  }, [pid]);

  const atFlag = t?.flag ? t.series.find((p) => p.time === t.flag?.time) : undefined;
  const drift = atFlag && t
    ? t.signals.filter((s) => (atFlag.z[s.key] ?? 0) >= 1)
        .map((s) => `${s.label.toLowerCase()} ${(atFlag.z[s.key] as number).toFixed(1)} SD toward risk`)
    : [];

  return (
    <section className="lead" aria-labelledby="lead-h">
      <header className="section-head">
        <h2 id="lead-h">Lead time</h2>
        <label className="lead-pick">
          <span className="sr-only">Storyline</span>
          <select value={pid ?? ""} onChange={(e) => setPid(e.target.value)}>
            {cases.map((c) => (
              <option key={c.patient_id} value={c.patient_id}>
                {c.name} · {c.label} · {SPLIT[c.split]} · {c.lead_days === null ? "no flag" : `${c.lead_days.toFixed(1)} d`}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {t && (
        <>
          <p className="lead-headline">{t.headline}</p>
          <p className="lead-meta">
            <span className="tag-synthetic">Synthetic data</span> {t.name} ({t.room}) · {t.label}
            {t.flag && <> · first flag <LevelBadge level={t.flag.level} /></>} · {SPLIT[t.split]} patient
          </p>
          {t.series.length > 1 ? <div className="timeline-wrap"><Chart t={t} /></div> : <p className="empty">No scores for this week.</p>}
          {drift.length > 0 && <p className="lead-drift">When the flag fired: {drift.join("; ")}.</p>}
          <p className="fineprint">
            All data is synthetic. Lead time runs from the first flag on this patient's own risk after the
            storyline began to the labelled outcome; the engine never sees the label.
            {t.flags_before_onset > 0 && ` ${t.flags_before_onset} earlier flag(s) before the storyline began are not counted.`}
            {" "}Flags are prompts for clinician review, not diagnoses.
          </p>
        </>
      )}
    </section>
  );
}
