import { useEffect, useState } from "react";
import Home from "./pages/Home";
import PatientPage from "./pages/PatientPage";
import NurseDashboard from "./pages/NurseDashboard";
import FamilyPage from "./pages/FamilyPage";
import ResearchPage from "./pages/ResearchPage";
import ProfilePage from "./pages/ProfilePage";

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
  const isFamily = page === "family";
  return (
    <>
      {!isPatient && (
        <nav className="topnav" aria-label="Main">
          <a href="#/" className="wordmark">SilentSignal</a>
          {!isFamily && (
            <>
              <a href="#/nurse" aria-current={page === "nurse" ? "page" : undefined}>Nurse station</a>
              <a href="#/research" aria-current={page === "research" ? "page" : undefined}>Pattern review</a>
            </>
          )}
          <span className="disclaimer">Prototype with synthetic data. Not a diagnostic device.</span>
        </nav>
      )}
      <main className={isPatient ? "patient-main" : `main main-${page ?? "home"}`}>
        {page === "patient" && id ? <PatientPage patientId={id} /> :
         page === "nurse" ? <NurseDashboard /> :
         page === "family" && id ? <FamilyPage personId={id} /> :
         page === "research" ? <ResearchPage /> :
         page === "profile" && id ? <ProfilePage patientId={id} /> : <Home />}
      </main>
    </>
  );
}
