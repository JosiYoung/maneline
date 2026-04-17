import { Routes, Route, Navigate } from "react-router-dom";
import { OwnerLayout } from "../../components/owner/OwnerLayout";

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
        <Route path="settings"          element={<Settings />} />
        {/* Unknown /app/* path falls back to Today. */}
        <Route path="*"                 element={<Navigate to="/app" replace />} />
      </Routes>
    </OwnerLayout>
  );
}
