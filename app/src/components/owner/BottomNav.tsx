import { NavLink } from "react-router-dom";
import {
  Home,
  PawPrint,
  FileText,
  Users,
  ShoppingBag,
  MessageCircle,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFeatureFlags } from "@/lib/featureFlags";

// BottomNav — fixed bottom tab bar for the Owner Portal.
//
// Per FRONTEND-UI-GUIDE.md §5.1: mobile-first, always visible, 44×44 tap
// targets. `end` on the Today link so /app/animals doesn't also light up
// the Home tab. The safe-area padding at the bottom is for iOS home-bar
// devices; browsers without the inset will see a no-op.
type Tab = {
  to: string;
  label: string;
  Icon: typeof Home;
  end?: boolean;
};

const BASE_TABS: Tab[] = [
  { to: "/app",          label: "Today",    Icon: Home,     end: true },
  { to: "/app/animals",  label: "Animals",  Icon: PawPrint },
  { to: "/app/barn",     label: "Barn",     Icon: CalendarDays },
  { to: "/app/records",  label: "Records",  Icon: FileText },
  { to: "/app/trainers", label: "Trainers", Icon: Users },
  { to: "/app/shop",     label: "Shop",     Icon: ShoppingBag },
];

const CHAT_TAB: Tab = {
  to: "/app/chat",
  label: "Brain",
  Icon: MessageCircle,
};

export function BottomNav() {
  const { flags } = useFeatureFlags();
  // Phase 4.4: chat tab is gated on feature:chat_v1 (fail-open).
  const tabs: Tab[] = flags.chat_v1 ? [...BASE_TABS, CHAT_TAB] : BASE_TABS;

  return (
    <nav
      aria-label="Owner portal primary navigation"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40",
        "border-t border-border bg-card",
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <ul className="mx-auto flex max-w-screen-md items-stretch justify-around">
        {tabs.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-16 min-w-[44px] flex-col items-center justify-center gap-1",
                  "text-xs font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
