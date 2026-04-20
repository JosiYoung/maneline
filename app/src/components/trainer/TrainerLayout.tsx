import { type ReactNode } from "react";
import { PortalHeader } from "../PortalHeader";
import { SidebarNav } from "./SidebarNav";
import { MobileSidebar } from "./MobileSidebar";
import { SupportWidget } from "../shared/SupportWidget";

// TrainerLayout — wraps every /trainer/* route.
//
// Per FRONTEND-UI-GUIDE.md §5.2: desktop-first with a persistent left
// sidebar, mobile fallback via a Sheet. Pure shadcn/ui — HeroUI is scoped
// to the Owner Portal (§4.1), so NO HeroUIProvider is rendered here.
//
// The shared `PortalHeader` handles role + sign-out at the very top; the
// sidebar only owns primary navigation, matching the owner portal's
// separation of concerns (PortalHeader + BottomNav).
export function TrainerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PortalHeader portal="trainer" />
      <div className="md:grid md:grid-cols-[14rem_1fr]">
        <aside
          className="hidden border-r border-border bg-card md:block"
          aria-label="Trainer navigation"
        >
          <SidebarNav />
        </aside>
        <div className="flex flex-col">
          <div className="flex items-center border-b border-border bg-card px-2 py-2 md:hidden">
            <MobileSidebar />
          </div>
          <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>
      <SupportWidget />
    </div>
  );
}
