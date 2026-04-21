import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { PortalHeader } from '../../components/PortalHeader';
import { PinSettings } from '../../components/PinSettings';
import AdminDashboard from './AdminDashboard';
import AdminOrderDetail from './OrderDetail';
import InvoicesIndex from './InvoicesIndex';
import OnboardingIndex from './OnboardingIndex';
import OnCallIndex from './OnCallIndex';
import OrdersIndex from './OrdersIndex';
import PlatformFeesIndex from './PlatformFeesIndex';
import SubscriptionsIndex from './SubscriptionsIndex';
import SubscriptionDetail from './SubscriptionDetail';
import SupportTicketsIndex from './SupportTicketsIndex';
import TrainerApplicationsIndex from './TrainerApplicationsIndex';
import UsersIndex from './UsersIndex';
import { SupportWidget } from '../../components/shared/SupportWidget';

// AdminIndex — /admin/*
//
// Phase 5 sub-prompt 5.2 adds the KPI dashboard (index) + user directory
// alongside the existing platform-fees tab. Every nested route is
// gated by ProtectedRoute allow="silver_lining" at the top-level
// router (app/src/App.tsx).

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users', end: false },
  { to: '/admin/onboarding', label: 'Onboarding', end: false },
  { to: '/admin/trainer-applications', label: 'Trainer queue', end: false },
  { to: '/admin/orders', label: 'Orders', end: false },
  { to: '/admin/invoices', label: 'Invoices', end: false },
  { to: '/admin/subscriptions', label: 'Subscriptions', end: false },
  { to: '/admin/support', label: 'Support', end: false },
  { to: '/admin/on-call', label: 'On-call', end: false },
  { to: '/admin/settings/fees', label: 'Fees', end: false },
] as const;

export default function AdminIndex() {
  return (
    <>
      <PortalHeader portal="admin" />
      <div className="mx-auto max-w-[1100px] px-6 py-4">
        <nav className="flex flex-wrap gap-4 border-b border-border pb-3 text-sm">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                isActive
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <main className="mx-auto max-w-[1100px] px-6 pb-16">
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<UsersIndex />} />
          <Route path="onboarding" element={<OnboardingIndex />} />
          <Route path="trainer-applications" element={<TrainerApplicationsIndex />} />
          <Route path="orders" element={<OrdersIndex />} />
          <Route path="orders/:id" element={<AdminOrderDetail />} />
          <Route path="invoices" element={<InvoicesIndex />} />
          <Route path="subscriptions" element={<SubscriptionsIndex />} />
          <Route path="subscriptions/:id" element={<SubscriptionDetail />} />
          <Route path="support" element={<SupportTicketsIndex />} />
          <Route path="on-call" element={<OnCallIndex />} />
          <Route path="settings/fees" element={<PlatformFeesIndex />} />
          <Route path="settings/pin" element={<PinSettings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
      <SupportWidget />
    </>
  );
}
