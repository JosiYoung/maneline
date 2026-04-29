import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { ProtectedRoute } from './components/ProtectedRoute';

import Home from './pages/Home';
import Login from './pages/Login';
import SignupPage from './pages/SignupPage';
import SignupCompleteProfile from './pages/SignupCompleteProfile';
import CheckEmail from './pages/CheckEmail';
import AuthCallback from './pages/AuthCallback';
import SetupPin from './pages/SetupPin';
import VetView from './pages/VetView';
import Welcome from './pages/Welcome';
import PublicEventAccept from './pages/PublicEventAccept';
import NotFound from './pages/NotFound';

import OwnerIndex from './pages/owner/OwnerIndex';
import TrainerIndex from './pages/trainer/TrainerIndex';
import TrainerPendingReview from './pages/trainer/PendingReview';
import AdminIndex from './pages/admin/AdminIndex';

export default function App() {
  return (
    <AuthGate>
      <Routes>
        {/* Public / unauthenticated */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/complete-profile" element={<SignupCompleteProfile />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/setup-pin" element={<SetupPin />} />

        {/* Vet view — scoped magic link, no session required */}
        <Route path="/vet/:token" element={<VetView />} />

        {/* Invitation deep-link — public, looks up the token server-side */}
        <Route path="/welcome" element={<Welcome />} />

        {/* Barn event invite — public, scoped by per-attendee token */}
        <Route path="/e/:token" element={<PublicEventAccept />} />

        {/* Owner portal */}
        <Route
          path="/app/*"
          element={
            <ProtectedRoute allow="owner">
              <OwnerIndex />
            </ProtectedRoute>
          }
        />

        {/* Trainer portal — ProtectedRoute handles the pending-review gate */}
        <Route
          path="/trainer/pending-review"
          element={
            <ProtectedRoute allow="trainer">
              <TrainerPendingReview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/*"
          element={
            <ProtectedRoute allow="trainer">
              <TrainerIndex />
            </ProtectedRoute>
          }
        />

        {/* Silver Lining admin portal */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allow="silver_lining">
              <AdminIndex />
            </ProtectedRoute>
          }
        />

        {/* Legacy path from the pre-SPA Worker — send them to the owner portal */}
        <Route path="/dashboard" element={<Navigate to="/app" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthGate>
  );
}
