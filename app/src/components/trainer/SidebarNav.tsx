import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Calendar,
  DollarSign,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// SidebarNav — the trainer portal's primary nav surface. Shared by the
// desktop persistent sidebar (TrainerLayout) and the mobile Sheet drawer
// (MobileSidebar) so the two can never drift.
//
// Tokens per FRONTEND-UI-GUIDE.md §3.5: active = text-primary, inactive =
// text-muted-foreground. Background is inherited from the surface the nav
// is rendered on (bg-card in both cases), so no `bg-*` is set here.

type Item = { to: string; label: string; Icon: LucideIcon; end?: boolean };

const NAV_ITEMS: Item[] = [
  { to: "/trainer",          label: "Dashboard", Icon: LayoutDashboard, end: true },
  { to: "/trainer/clients",  label: "Clients",   Icon: Users },
  { to: "/trainer/sessions", label: "Sessions",  Icon: Calendar },
  { to: "/trainer/payouts",  label: "Payouts",   Icon: DollarSign },
  { to: "/trainer/account",  label: "Account",   Icon: User },
];

interface SidebarNavProps {
  /** Called after a NavLink is clicked — used by the mobile Sheet to close itself. */
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  return (
    <nav
      aria-label="Trainer portal primary navigation"
      className="flex flex-col gap-1 p-3"
    >
      {NAV_ITEMS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "min-h-[44px]",
              isActive
                ? "bg-secondary text-primary"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={18}
                strokeWidth={isActive ? 2.25 : 1.75}
                aria-hidden="true"
              />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
