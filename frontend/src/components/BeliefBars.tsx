import type { BeliefItem } from "@shared/types";
import { pct } from "../api";

/** Horizontal bars for the top needs. Risk is shown as a text tag, never colour alone. */
export default function BeliefBars({ items, set }: { items: BeliefItem[]; set?: string[] }) {
  return (
    <ul className="belief" aria-label="Most likely needs">
      {items.map((b) => (
        <li key={b.need}>
          <span className="belief-label">
            {b.label}
            {b.risk === "high" && <span className="tag tag-high">⚠ high risk</span>}
            {set?.includes(b.need) && <span className="tag">in 90% set</span>}
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
