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
      <header className="research-head">
        <div>
          <h1>Research agent</h1>
          <p className="muted small">Observations from clinicians and patterns the system detects become hypotheses. For each one the
            agent decides whether to check the data, ask a clinician who knows the patient, or wait for more episodes,
            and updates its confidence from the evidence. Nothing becomes a finding until the clinical lead reviews it.</p>
        </div>
        <button className="btn primary" onClick={run} disabled={running}>{running ? "Running…" : "Run research cycle"}</button>
      </header>

      {digest && (
        <section className="card digest" aria-label="Research digest">
          <h2>This shift</h2>
          <p>{digest.text}</p>
          <p className="muted small">{digest.source === "gemini" ? "Phrased by Gemini from the counts" : "Generated from the counts"}</p>
        </section>
      )}

      <div className="research-grid">
        <div className="research-main">
          <section aria-labelledby="pending-h">
            <h2 id="pending-h">Pending review <span className="count">{pending.length}</span></h2>
            {pending.length === 0
              ? <p className="muted small">Nothing has crossed a review threshold yet.</p>
              : <p className="muted small">Human review is required before any hypothesis is treated as a finding.</p>}
            {pending.map((h) => <HypothesisCard key={h.id} h={h} mode="review" />)}
          </section>

          <section aria-labelledby="active-h">
            <h2 id="active-h">Active hypotheses <span className="count">{active.length}</span></h2>
            {active.map((h) => <HypothesisCard key={h.id} h={h} mode="active" />)}
          </section>

          <section aria-labelledby="history-h">
            <h2 id="history-h">Validated / rejected <span className="count">{done.length}</span></h2>
            {done.length === 0 && <p className="muted small">No reviewed hypotheses yet. Evidence and history are kept here after review.</p>}
            {done.map((h) => <HypothesisCard key={h.id} h={h} mode="history" />)}
          </section>
        </div>

        <aside className="research-side">
          <section aria-labelledby="inq-h">
            <h2 id="inq-h">Clinician inquiries <span className="count">{inquiries.length}</span></h2>
            {inquiries.length === 0 && <p className="muted small">The agent has no open questions.</p>}
            {inquiries.map((i) => <InquiryCard key={i.id} inquiry={i} />)}
          </section>
          <ObservationForm staff={staff} patients={patients} />
        </aside>
      </div>
    </div>
  );
}
