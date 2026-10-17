import { useState } from "react";
import type { SilenceLadder } from "@shared/types";
import { api, timeAgo } from "../api";

/** Shown to the trusted contact when an inactivity check reaches them. Their answer is the explicit
 *  acknowledgement for this step: "okay" closes the check, "worried" alerts the nurse straight away. */
export default function SilenceCheckCard({ ladder, personId, onChange }: {
  ladder: SilenceLadder; personId: string; onChange: (l: SilenceLadder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = ladder.patient_name.split(" ")[0];
  const mine = ladder.steps.find((s) => s.kind === "contact");
  const answered = mine?.status === "acknowledged";

  const ack = async (outcome: "ok" | "concern") => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.post<SilenceLadder>(`/api/risk/silence/ladders/${ladder.id}/ack`,
                                             { step: "contact", role: "contact", actor: personId, outcome }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="consult silence-check" aria-live="assertive">
      <p className="consult-when">Inactivity check · started {timeAgo(ladder.started_at)}</p>
      <p className="consult-q">
        {first} hasn't used their tablet for longer than usual and didn't answer a check on it.
        Can you check on {first}?
      </p>
      <p className="muted">{ladder.reason}</p>
      {answered ? (
        <p className="welfare-status" aria-live="polite">
          {mine?.outcome === "concern" ? "Thank you. Their nurse has been alerted." : "Thank you, noted."}
          {ladder.current === "nurse" && " Their nurse will check in person."}
        </p>
      ) : (
        <div className="consult-options">
          <button className="choice" disabled={busy} onClick={() => ack("ok")}>I've checked: {first} is okay</button>
          <button className="choice" disabled={busy} onClick={() => ack("concern")}>I'm worried: alert the nurse</button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </article>
  );
}
