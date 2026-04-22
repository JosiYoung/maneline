import { NavLink } from "react-router-dom";
import {
  CalendarDays,
  HeartPulse,
  MapPinned,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; Icon: LucideIcon };

const ITEMS: Item[] = [
  { to: "/app/barn/calendar", label: "Calendar", Icon: CalendarDays },
  { to: "/app/barn/health",   label: "Health",   Icon: HeartPulse },
  { to: "/app/barn/facility", label: "Facility", Icon: MapPinned },
  { to: "/app/barn/spending", label: "Spending", Icon: Wallet },
];

export function BarnSubNav() {
  return (
    <nav
      aria-label="Barn sections"
      className="-mx-1 flex gap-1 overflow-x-auto pb-1"
    >
      {ITEMS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-primary"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={16}
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
