import { Routes, Route, Navigate } from "react-router-dom";
import { OwnerLayout } from "../../components/owner/OwnerLayout";
import { WelcomeTour } from "../../components/WelcomeTour";

import TodayView     from "../app/TodayView";
import AnimalsIndex  from "../app/AnimalsIndex";
import AnimalNew     from "../app/AnimalNew";
import AnimalEdit    from "../app/AnimalEdit";
import AnimalDetail  from "../app/AnimalDetail";
import RecordsIndex  from "../app/RecordsIndex";
import ExportRecords from "../app/ExportRecords";
import TrainersIndex from "../app/TrainersIndex";
import TrainerInvite from "../app/TrainerInvite";
import Settings      from "../app/Settings";
import SessionApproveAndPay from "../app/SessionApproveAndPay";
import ShopIndex     from "./shop/ShopIndex";
import ProductDetail from "./shop/ProductDetail";
import BarnCalendar  from "./BarnCalendar";
import BarnContacts  from "./BarnContacts";
import BarnHealth    from "./BarnHealth";
import BarnHealthThresholds from "./BarnHealthThresholds";
import BarnHealthAnimal     from "./BarnHealthAnimal";
import BarnFacility  from "./BarnFacility";
import BarnSpending       from "./BarnSpending";
import BarnSpendingAnimal from "./BarnSpendingAnimal";
import SettingsSubscription from "./SettingsSubscription";
import OrderReturn   from "./orders/OrderReturn";
import OrdersIndex   from "./orders/OrdersIndex";
import ChatIndex        from "../app/chat/ChatIndex";
import ConversationView from "../app/chat/ConversationView";

// OwnerIndex — /app/* dispatcher. Wraps every owner route in OwnerLayout
// (HeroUIProvider + PortalHeader + BottomNav) and hands off to the page
// component for the matched sub-route. Phase 1.4 onwards hangs more
// routes off here (/app/animals/new, /app/animals/:id, etc).
export default function OwnerIndex() {
  return (
    <OwnerLayout>
      <Routes>
        <Route index                    element={<TodayView />} />
        <Route path="animals"           element={<AnimalsIndex />} />
        <Route path="animals/new"       element={<AnimalNew />} />
        <Route path="animals/:id"       element={<AnimalDetail />} />
        <Route path="animals/:id/edit"  element={<AnimalEdit />} />
        <Route path="records"           element={<RecordsIndex />} />
        <Route path="records/export"    element={<ExportRecords />} />
        <Route path="trainers"          element={<TrainersIndex />} />
        <Route path="trainers/invite"   element={<TrainerInvite />} />
        <Route path="sessions/:id/pay"  element={<SessionApproveAndPay />} />
        <Route path="shop"              element={<ShopIndex />} />
        <Route path="shop/:handle"      element={<ProductDetail />} />
        <Route path="barn"              element={<Navigate to="/app/barn/calendar" replace />} />
        <Route path="barn/calendar"     element={<BarnCalendar />} />
        <Route path="barn/contacts"     element={<BarnContacts />} />
        <Route path="barn/health"                   element={<BarnHealth />} />
        <Route path="barn/health/thresholds"        element={<BarnHealthThresholds />} />
        <Route path="barn/health/animals/:id"       element={<BarnHealthAnimal />} />
        <Route path="barn/facility"                 element={<BarnFacility />} />
        <Route path="barn/spending"                 element={<BarnSpending />} />
        <Route path="barn/spending/animals/:id"     element={<BarnSpendingAnimal />} />
        <Route path="orders"            element={<OrdersIndex />} />
        <Route path="orders/:id"        element={<OrderReturn />} />
        <Route path="chat"                         element={<ChatIndex />} />
        <Route path="chat/:conversationId"         element={<ConversationView />} />
        <Route path="settings"                    element={<Settings />} />
        <Route path="settings/subscription"       element={<SettingsSubscription />} />
        {/* Unknown /app/* path falls back to Today. */}
        <Route path="*"                 element={<Navigate to="/app" replace />} />
      </Routes>
      <WelcomeTour />
    </OwnerLayout>
  );
}
