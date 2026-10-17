import LeadTimeline from "../risk/LeadTimeline";

export default function EarlyWarningPage() {
  return (
    <div className="early-warning">
      <header className="early-head">
        <h1>Early warning, replayed</h1>
        <p>
          Fourteen days of synthetic activity per resident. Each storyline drifts over 3 to 5 days before a labelled
          outcome. The engine sees only taps, chart events and fatigue, compared with the patient's own previous week.
        </p>
      </header>
      <LeadTimeline />
    </div>
  );
}
