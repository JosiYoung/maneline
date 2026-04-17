import { Routes, Route, Navigate } from "react-router-dom";
import { TrainerLayout } from "../../components/trainer/TrainerLayout";
import TrainerDashboard from "./TrainerDashboard";
import TrainerAccount from "./TrainerAccount";
import ClientsIndex from "./ClientsIndex";
import TrainerComingSoon from "./TrainerComingSoon";

// TrainerIndex — the trainer portal's route shell. Mounted under
// <ProtectedRoute allow="trainer"> in App.tsx, so every child route here
// is already role-gated; we don't re-check.
//
// Phase 2 Prompt 2.2 wires the shell + Dashboard. The remaining tabs
// (Clients / Sessions / Payouts / Account) render TrainerComingSoon
// until 2.3-2.6 swap each route target to its real feature component.
export default function TrainerIndex() {
  return (
    <TrainerLayout>
      <Routes>
        <Route index element={<TrainerDashboard />} />
        <Route path="clients"  element={<ClientsIndex />} />
        <Route path="sessions" element={<TrainerComingSoon title="Sessions" />} />
        <Route path="payouts"  element={<TrainerComingSoon title="Payouts" />} />
        <Route path="account"  element={<TrainerAccount />} />
        <Route path="*" element={<Navigate to="/trainer" replace />} />
      </Routes>
    </TrainerLayout>
  );
}
