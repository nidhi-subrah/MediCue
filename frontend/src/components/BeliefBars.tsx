import type { BeliefItem } from "@shared/types";
import { pct } from "../api";

/** Horizontal bars for the top needs. Risk is shown in text as well as colour. */
export default function BeliefBars({ items, set }: { items: BeliefItem[]; set?: string[] }) {
  return (
    <ul className="belief" aria-label="Most likely needs">
      {items.map((b) => (
        <li key={b.need} className={`${b.risk === "high" ? "is-high" : ""} ${set?.includes(b.need) ? "in-set" : ""}`}>
          <span className="belief-label">
            {b.label}
            {b.risk === "high" && <span className="risk-note">high risk</span>}
          </span>
          <span className="belief-track" aria-hidden>
            <span className="belief-fill" style={{ width: `${Math.max(b.p * 100, 1)}%` }} />
          </span>
          <span className="belief-value">{pct(b.p)}</span>
        </li>
      ))}
    </ul>
  );
}
