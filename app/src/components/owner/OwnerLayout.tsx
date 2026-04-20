import { type ReactNode } from "react";
import { HeroUIProvider } from "@heroui/react";
import { PortalHeader } from "../PortalHeader";
import { BottomNav } from "./BottomNav";
import { SupportWidget } from "../shared/SupportWidget";

// OwnerLayout — wraps every /app/* route.
//
// Per FRONTEND-UI-GUIDE.md §4.2, HeroUIProvider is scoped here (NOT at
// the app root) so the Trainer and Admin portals keep running on pure
// shadcn/ui. `pb-24` on <main> reserves space for the fixed BottomNav so
// content never hides behind it.
export function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <HeroUIProvider>
      <div className="min-h-screen bg-background text-foreground">
        <PortalHeader portal="owner" />
        <main className="mx-auto max-w-screen-md px-4 pb-24 pt-6">
          {children}
        </main>
        <BottomNav />
        <SupportWidget />
      </div>
    </HeroUIProvider>
  );
}
