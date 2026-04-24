import { type ReactNode } from "react";
import { HeroUIProvider } from "@heroui/react";
import { PortalHeader } from "../PortalHeader";
import { ErrorBoundary } from "../ErrorBoundary";
import { BottomNav } from "./BottomNav";
import { SupportWidget } from "../shared/SupportWidget";

// OwnerLayout — wraps every /app/* route.
//
// Per FRONTEND-UI-GUIDE.md §4.2, HeroUIProvider is scoped here (NOT at
// the app root) so the Trainer and Admin portals keep running on pure
// shadcn/ui. `pb-24` on <main> reserves space for the fixed BottomNav so
// content never hides behind it.
//
// The scoped <ErrorBoundary> around <main> catches child crashes without
// forcing the user to reload the whole SPA (root boundary still exists
// in main.tsx as the final net). "Reset" re-mounts the matched route
// with the current session + react-query cache intact.
export function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <HeroUIProvider>
      <div className="min-h-screen bg-background text-foreground">
        <PortalHeader portal="owner" />
        <main className="mx-auto max-w-screen-md px-4 pb-24 pt-6">
          <ErrorBoundary fallback={scopedFallback}>{children}</ErrorBoundary>
        </main>
        <BottomNav />
        <SupportWidget />
      </div>
    </HeroUIProvider>
  );
}

function scopedFallback(err: Error, reset: () => void) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
      <h2 className="font-display text-xl text-primary">Something went wrong on this screen.</h2>
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
