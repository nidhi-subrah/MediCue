import type { ProfileItem } from "@shared/types";

/** Profile items as "effect, with the quote that justifies it". */
export default function ProfileList({ items, empty }: { items: ProfileItem[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="profile-empty">{empty}</p> : null;
  return (
    <ul className="profile-list">
      {items.map((i, n) => (
        <li key={n} className={i.kind === "note" ? "is-note" : ""}>
          <span className="profile-effect">{i.effect}</span>
          {i.kind !== "note" && <q className="profile-quote">{i.evidence}</q>}
          {i.origin === "nurse" && <span className="profile-origin">added from a nurse's note</span>}
        </li>
      ))}
    </ul>
  );
}
