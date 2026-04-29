import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { ProtectedRoute } from './components/ProtectedRoute';

// Each route is split into its own chunk so a cold load only ships the
// page the user is on. The big authenticated portals (owner / trainer /
// admin) used to be in the main bundle along with the marketing site,
// pushing a single 2.1 MB JS file to every visitor — even people just
// hitting the landing page. With route-level splitting + manualChunks
// in vite.config.ts, each route loads ~hundreds of KB max.
const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const SignupCompleteProfile = lazy(() => import('./pages/SignupCompleteProfile'));
const CheckEmail = lazy(() => import('./pages/CheckEmail'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const SetupPin = lazy(() => import('./pages/SetupPin'));
const VetView = lazy(() => import('./pages/VetView'));
const Welcome = lazy(() => import('./pages/Welcome'));
const PublicEventAccept = lazy(() => import('./pages/PublicEventAccept'));
const NotFound = lazy(() => import('./pages/NotFound'));

const OwnerIndex = lazy(() => import('./pages/owner/OwnerIndex'));
const TrainerIndex = lazy(() => import('./pages/trainer/TrainerIndex'));
const TrainerPendingReview = lazy(() => import('./pages/trainer/PendingReview'));
const AdminIndex = lazy(() => import('./pages/admin/AdminIndex'));

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 14,
      }}
    >
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
    </AuthGate>
  );
}
