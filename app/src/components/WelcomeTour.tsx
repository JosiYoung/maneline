import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dismissWelcomeTour } from "@/lib/invitations";
import { useAuthStore } from "@/lib/authStore";

// WelcomeTour — 3-step dismissible dialog shown once per user.
//
// Phase 6.2 feature #2. Role-aware copy for owner vs trainer. Gated
// by user_profiles.welcome_tour_seen_at; dismissing stamps the column
// via /api/profiles/dismiss-welcome-tour. We close the dialog
// optimistically on first user action and fire the server write in
// the background — the local `dismissed` ref prevents the effect from
// re-opening the dialog if refreshProfile is slow or fails.

type TourRole = "owner" | "trainer";

type Step = { title: string; body: string };

const STEPS: Record<TourRole, Step[]> = {
  owner: [
    {
      title: "Welcome to Mane Line",
      body: "Your Silver Lining barn portal. Records, shop, vet share, and a herbal-care chatbot — all scoped to your horses.",
    },
    {
      title: "Add your first animal",
      body: "Head to \"Animals\" to add a horse. Each one gets its own record timeline, protocols, and gallery.",
    },
    {
      title: "Ask Mane Line anything",
      body: "The chatbot can recommend Silver Lining herbs based on symptoms, link to protocols, and escalate to a vet-share link.",
    },
  ],
  trainer: [
    {
      title: "Welcome, trainer",
      body: "Log sessions for the horses your clients share with you. Your roster appears in \"Clients\" once access is granted.",
    },
    {
      title: "Log a session",
      body: "From an animal's page, tap \"New session\" to record training notes. Owners see the log and can approve + pay.",
    },
    {
      title: "Stripe Connect for payouts",
      body: "Complete Stripe Express onboarding from the earnings tab so session payments flow to your bank.",
    },
  ],
};

export function WelcomeTour() {
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // Local latch: once the user clicks away, never reopen this session
  // even if profile.welcome_tour_seen_at arrives back null (e.g. server
  // error, offline). Belt-and-suspenders against the stuck-dialog bug.
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (dismissedRef.current) return;
    if (!profile) return;
    if (profile.role !== "owner" && profile.role !== "trainer") return;
    if (profile.welcome_tour_seen_at) return;
    setOpen(true);
  }, [profile]);

  const role = (profile?.role === "owner" || profile?.role === "trainer")
    ? profile.role
    : null;

  function dismiss() {
    dismissedRef.current = true;
    setOpen(false);
    setStep(0);
    // Fire-and-forget server write; we don't gate the close on it.
    void dismissWelcomeTour()
      .then(() => refreshProfile())
      .catch(() => { /* local latch already closed the tour */ });
  }

  if (!role) return null;
  const steps = STEPS[role];
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) dismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-1 py-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-8 rounded-full ${
                i === step ? "bg-primary" : "bg-muted"
              }`}
              aria-hidden
            />
          ))}
        </div>
        <DialogFooter>
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={dismiss}>
              Skip
            </Button>
          )}
          {isLast ? (
            <Button onClick={dismiss}>Let's go</Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
