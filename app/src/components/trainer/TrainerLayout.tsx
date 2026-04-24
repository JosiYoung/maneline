import { type ReactNode } from "react";
import { PortalHeader } from "../PortalHeader";
import { ErrorBoundary } from "../ErrorBoundary";
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
            <ErrorBoundary fallback={scopedFallback}>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
      <SupportWidget />
    </div>
  );
}

// Scoped fallback — keeps the sidebar and header mounted so the trainer
// can jump to another screen without losing session/query state. Root
// boundary in main.tsx still catches anything that escapes this one.
function scopedFallback(err: Error, reset: () => void) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
      <h2 className="text-xl font-medium">Something went wrong on this screen.</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {err.message || "An unexpected error occurred."}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          Reload app
        </button>
      </div>
    </div>
  );
}
