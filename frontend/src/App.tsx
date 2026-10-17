import { useEffect, useState } from "react";
import Home from "./pages/Home";
import PatientPage from "./pages/PatientPage";
import NurseDashboard from "./pages/NurseDashboard";
import FamilyPage from "./pages/FamilyPage";
import ResearchPage from "./pages/ResearchPage";

function useHashRoute() {
  const [hash, setHash] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.split("/").filter(Boolean);
}

export default function App() {
  const [page, id] = useHashRoute();
  const isPatient = page === "patient";
  return (
    <>
      {!isPatient && (
        <nav className="topnav" aria-label="Main">
          <a href="#/" className="brand">SilentSignal</a>
          <a href="#/nurse" aria-current={page === "nurse" ? "page" : undefined}>Nurse</a>
          <a href="#/research" aria-current={page === "research" ? "page" : undefined}>Research</a>
          <span className="disclaimer">Prototype · synthetic data · not a diagnostic device</span>
        </nav>
      )}
      <main className={isPatient ? "patient-main" : "main"}>
        {page === "patient" && id ? <PatientPage patientId={id} /> :
         page === "nurse" ? <NurseDashboard /> :
         page === "family" && id ? <FamilyPage personId={id} /> :
         page === "research" ? <ResearchPage /> : <Home />}
      </main>
    </>
  );
}
