import { Routes, Route, Navigate } from "react-router-dom";
import { TrainerLayout } from "../../components/trainer/TrainerLayout";
import { WelcomeTour } from "../../components/WelcomeTour";
import TrainerDashboard from "./TrainerDashboard";
import BusinessDashboard from "./BusinessDashboard";
import TrainerAccount from "./TrainerAccount";
import TrainerSettingsSubscription from "./SettingsSubscription";
import ClientsIndex from "./ClientsIndex";
import ClientRoster from "./ClientRoster";
import AnimalReadOnly from "./AnimalReadOnly";
import SessionsIndex from "./SessionsIndex";
import SessionNew from "./SessionNew";
import SessionDetail from "./SessionDetail";
import PayoutsIndex from "./PayoutsIndex";
import ExpensesIndex from "./ExpensesIndex";
import InvoicesIndex from "./InvoicesIndex";
import InvoiceDetail from "./InvoiceDetail";
import RecurringItemsIndex from "./RecurringItemsIndex";
import MySchedule from "./MySchedule";

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
        <Route path="business"    element={<BusinessDashboard />} />
        <Route path="clients"             element={<ClientsIndex />} />
        <Route path="clients/:ownerId"    element={<ClientRoster />} />
        <Route path="animals/:id"         element={<AnimalReadOnly />} />
        <Route path="sessions"          element={<SessionsIndex />} />
        <Route path="sessions/new"      element={<SessionNew />} />
        <Route path="sessions/:id"      element={<SessionDetail />} />
        <Route path="expenses"    element={<ExpensesIndex />} />
        <Route path="invoices"           element={<InvoicesIndex />} />
        <Route path="invoices/recurring" element={<RecurringItemsIndex />} />
        <Route path="invoices/:id"       element={<InvoiceDetail />} />
        <Route path="my-schedule" element={<MySchedule />} />
        <Route path="payouts"     element={<PayoutsIndex />} />
        <Route path="account"      element={<TrainerAccount />} />
        <Route path="subscription" element={<TrainerSettingsSubscription />} />
        <Route path="*" element={<Navigate to="/trainer" replace />} />
      </Routes>
      <WelcomeTour />
    </TrainerLayout>
  );
}
