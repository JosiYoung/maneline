import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/authStore";
import {
  claimInvitation,
  lookupInvitation,
  type InvitationLookup,
} from "@/lib/invitations";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";

// Welcome — /welcome?i=<token>
//
// Phase 6.2 deep-link landing page for invited beta users.
// Flow:
//   1. Look up the token → display branded "you're invited" card.
//   2. If user is already signed in AND email matches → auto-claim and
//      redirect to /app or /trainer.
//   3. Otherwise → capture the invitation token in sessionStorage, send
//      a Supabase magic-link email to the invitation's address, and show
//      "check your email" state. After the user clicks the magic link
//      + authenticates, AuthGate picks up the pending token and claims.

const PENDING_KEY = "maneline:pending-invite-token";

export default function Welcome() {
  const [params] = useSearchParams();
  const token = (params.get("i") || "").trim();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "invalid"; reason: string }
    | { kind: "invited"; invite: InvitationLookup }
    | { kind: "sending" }
    | { kind: "sent"; email: string }
    | { kind: "claimed"; role: "owner" | "trainer" }
  >({ kind: "loading" });

  // 1) Look up the token.
  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid", reason: "missing_token" });
      return;
    }
    lookupInvitation(token)
      .then((invite) => setState({ kind: "invited", invite }))
      .catch((e) => {
        const code = (e as Error & { code?: string }).code;
        setState({ kind: "invalid", reason: code || "lookup_failed" });
      });
  }, [token]);

  // 2) If already signed in and email matches, claim immediately.
  useEffect(() => {
    if (state.kind !== "invited") return;
    if (!session?.user) return;
    const sessEmail = (session.user.email || "").toLowerCase();
    if (sessEmail !== state.invite.email.toLowerCase()) return;
    claimInvitation(token)
      .then((res) => {
        sessionStorage.removeItem(PENDING_KEY);
        setState({ kind: "claimed", role: res.role });
        navigate(res.role === "trainer" ? "/trainer" : "/app", { replace: true });
      })
      .catch((e) => notify.error(mapSupabaseError(e)));
  }, [state, session, token, navigate]);

  async function sendMagicLink() {
    if (state.kind !== "invited") return;
    setState({ kind: "sending" });
    sessionStorage.setItem(PENDING_KEY, token);
    const { error } = await supabase.auth.signInWithOtp({
      email: state.invite.email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      notify.error(mapSupabaseError(error));
      setState({ kind: "invited", invite: state.invite });
      return;
    }
    setState({ kind: "sent", email: state.invite.email });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
      <Card className="w-full">
        <CardContent className="space-y-5 py-8">
          {state.kind === "loading" ? (
            <div className="space-y-2">
              <div className="h-6 w-2/3 animate-pulse rounded bg-muted/50" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted/50" />
            </div>
          ) : null}

          {state.kind === "invalid" ? (
            <div className="space-y-3">
              <h1 className="text-2xl">This invite isn't valid</h1>
              <p className="text-sm text-muted-foreground">
                {reasonCopy(state.reason)}
              </p>
              <Button variant="outline" onClick={() => navigate("/login")}>
                Go to sign in
              </Button>
            </div>
          ) : null}

          {state.kind === "invited" ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl">You're invited to Mane Line</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {state.invite.role === "trainer"
                    ? "You're joining as a trainer — you'll see your client roster and can log sessions."
                    : "Your Silver Lining barn portal — records, shop, chat, and more."}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                <div className="text-muted-foreground">Invited email</div>
                <div className="font-mono">{state.invite.email}</div>
                {state.invite.barn_name ? (
                  <>
                    <div className="mt-2 text-muted-foreground">Barn</div>
                    <div>{state.invite.barn_name}</div>
                  </>
                ) : null}
              </div>
              <Button className="w-full" onClick={sendMagicLink}>
                Email me a sign-in link
              </Button>
              <p className="text-xs text-muted-foreground">
                We'll email a one-time link to the address above. Clicking it signs you in.
              </p>
            </div>
          ) : null}

          {state.kind === "sending" ? (
            <div className="space-y-2">
              <h1 className="text-2xl">Sending…</h1>
              <div className="h-4 w-full animate-pulse rounded bg-muted/50" />
            </div>
          ) : null}

          {state.kind === "sent" ? (
            <div className="space-y-3">
              <h1 className="text-2xl">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                We sent a sign-in link to <span className="font-mono">{state.email}</span>. Click it from your mail app to finish.
              </p>
              <Label className="text-xs text-muted-foreground">No link?</Label>
              <div className="flex gap-2">
                <Input readOnly value={state.email} className="font-mono text-xs" />
                <Button variant="outline" onClick={() => setState({ kind: "invited", invite: { email: state.email, role: "owner", barn_name: null, expires_at: "" } })}>
                  Resend
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function reasonCopy(reason: string): string {
  switch (reason) {
    case "missing_token": return "The invite link is missing a token. Ask your admin for a new one.";
    case "not_found":     return "We couldn't find this invitation. It may have been archived.";
    case "expired":       return "This invitation expired. Ask your admin to resend.";
    case "archived":      return "This invitation was revoked.";
    case "already_accepted": return "This invitation has already been used. Sign in directly from the login page.";
    default:              return "Try again from the link in your email, or contact your admin.";
  }
}
