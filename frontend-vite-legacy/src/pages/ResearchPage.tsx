import { useCallback, useEffect, useState } from "react";
import type { Patient, ResearchDigest, ResearchHypothesis, ResearchInquiry, StaffMember } from "@shared/types";
import { api, useChannel } from "../api";
import HypothesisCard from "../components/research/HypothesisCard";
import InquiryCard from "../components/research/InquiryCard";
import ObservationForm from "../components/research/ObservationForm";

const PENDING = new Set(["SUPPORTED_PENDING_REVIEW", "REJECTED_PENDING_REVIEW"]);
const DONE = new Set(["VALIDATED", "REJECTED"]);

export default function ResearchPage() {
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([]);
  const [inquiries, setInquiries] = useState<ResearchInquiry[]>([]);
  const [digest, setDigest] = useState<ResearchDigest | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const [h, i, d] = await Promise.all([
      api.get<ResearchHypothesis[]>("/api/research/hypotheses"),
      api.get<ResearchInquiry[]>("/api/research/inquiries?status=pending"),
      api.get<ResearchDigest>("/api/research/digest"),
    ]);
    setHypotheses(h);
    setInquiries(i);
    setDigest(d);
  }, []);

  useEffect(() => {
    load();
    api.get<{ staff: StaffMember[] }>("/api/research/clinicians").then((r) => setStaff(r.staff));
    api.get<Patient[]>("/api/patients").then(setPatients);
  }, [load]);

  useChannel("research", (m) => { if (m.type === "research_updated") load(); });

  const run = async () => {
    setRunning(true);
    try { await api.post("/api/research/cycle"); await load(); } finally { setRunning(false); }
  };

  const pending = hypotheses.filter((h) => PENDING.has(h.status));
  // Clinician observations first (a person is waiting on them), then the most decided.
  const active = hypotheses.filter((h) => !PENDING.has(h.status) && !DONE.has(h.status))
    .sort((a, b) => Number(b.origin === "clinician") - Number(a.origin === "clinician")
      || Math.abs(b.confidence - 0.5) - Math.abs(a.confidence - 0.5));
  const done = hypotheses.filter((h) => DONE.has(h.status));

  return (
    <div className="research research-agent">
      <header className="section-head research-head">
        <div>
          <h1>Research</h1>
          <p className="section-meta">
            {pending.length} awaiting review · {active.length} under investigation · {inquiries.length} question{inquiries.length === 1 ? "" : "s"} for clinicians
          </p>
        </div>
        <button className="btn" onClick={run} disabled={running}>{running ? "Running…" : "Run research cycle"}</button>
      </header>
      <p className="research-intro">
        Clinician observations and patterns found in confirmed requests become hypotheses. For each one the agent
        chooses to check the data, ask a clinician who knows the patient, or wait for more episodes, and updates its
        confidence from what it finds. Nothing is treated as a finding until the clinical lead reviews it.
      </p>

      {digest && (
        <section className="digest" aria-label="Research digest">
          <p className="digest-kicker">This shift</p>
          <p className="digest-text">{digest.text}</p>
          {digest.source === "gemini" && <p className="by">Phrased by Gemini from the counts</p>}
        </section>
      )}

      <div className="research-grid">
        <div className="research-main">
          <section className="research-section" aria-labelledby="pending-h">
            <header className="section-head"><h2 id="pending-h">Pending review</h2><span className="section-meta">{pending.length}</span></header>
            {pending.length === 0
              ? <p className="empty">Nothing has crossed a review threshold yet.</p>
              : <p className="research-note">Human review is required before any hypothesis is treated as a finding.</p>}
            {pending.map((h) => <HypothesisCard key={h.id} h={h} mode="review" />)}
          </section>

          <section className="research-section" aria-labelledby="active-h">
            <header className="section-head"><h2 id="active-h">Active hypotheses</h2><span className="section-meta">{active.length}</span></header>
            {active.length === 0 && <p className="empty">No hypotheses under investigation.</p>}
            {active.map((h) => <HypothesisCard key={h.id} h={h} mode="active" />)}
          </section>

          <section className="research-section" aria-labelledby="history-h">
            <header className="section-head"><h2 id="history-h">Validated and rejected</h2><span className="section-meta">{done.length}</span></header>
            {done.length === 0 && <p className="empty">Nothing reviewed yet. Evidence and history stay here after review.</p>}
            {done.map((h) => <HypothesisCard key={h.id} h={h} mode="history" />)}
          </section>
        </div>

        <aside className="research-side">
          <section className="research-section" aria-labelledby="inq-h">
            <header className="section-head"><h2 id="inq-h">Questions for clinicians</h2><span className="section-meta">{inquiries.length}</span></header>
            {inquiries.length === 0 && <p className="empty">The agent has no open questions.</p>}
            {inquiries.map((i) => <InquiryCard key={i.id} inquiry={i} />)}
          </section>
          <ObservationForm staff={staff} patients={patients} />
        </aside>
      </div>
    </div>
  );
}
