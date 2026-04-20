import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

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
import { notify } from "@/lib/toast";

// WelcomeTour — 3-step dismissible dialog shown once per user.
//
// Phase 6.2 feature #2. Role-aware copy for owner vs trainer. Gated
// by user_profiles.welcome_tour_seen_at; dismissing stamps the column
// via /api/profiles/dismiss-welcome-tour and refreshes the local
// profile so the tour never re-opens in the same session.

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

function useWelcomeTourEligibility(): {
  open: boolean;
  role: TourRole | null;
  setOpen: (v: boolean) => void;
} {
  const profile = useAuthStore((s) => s.profile);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== "owner" && profile.role !== "trainer") return;
    if (profile.welcome_tour_seen_at) return;
    setOpen(true);
  }, [profile]);
  const role = (profile?.role === "owner" || profile?.role === "trainer")
    ? profile.role
    : null;
  return { open, role, setOpen };
}

export function WelcomeTour() {
  const { open, role, setOpen } = useWelcomeTourEligibility();
  const [step, setStep] = useState(0);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const dismissM = useMutation({
    mutationFn: () => dismissWelcomeTour(),
    onSuccess: async () => {
      setOpen(false);
      setStep(0);
      await refreshProfile();
    },
    onError: (e: Error) => {
      notify.error(e.message);
      setOpen(false);
    },
  });

  if (!role) return null;
  const steps = STEPS[role];
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) dismissM.mutate();
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
            <Button variant="ghost" onClick={() => dismissM.mutate()} disabled={dismissM.isPending}>
              Skip
            </Button>
          )}
          {isLast ? (
            <Button onClick={() => dismissM.mutate()} disabled={dismissM.isPending}>
              {dismissM.isPending ? "Saving…" : "Let's go"}
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
