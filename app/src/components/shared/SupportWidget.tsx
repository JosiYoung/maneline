import { useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuthStore } from "@/lib/authStore";
import { notify } from "@/lib/toast";
import {
  SUPPORT_CATEGORY_LABEL,
  type SubmitSupportTicketInput,
  type SupportCategory,
  submitSupportTicket,
} from "@/lib/support";

// SupportWidget — floating button + shadcn Sheet. Mounted on every
// authenticated portal shell (owner + trainer + admin) and on the
// public landing in anon mode. Per Phase 5.4, anon submissions are
// restricted to bug + feature_request; signed-in users see all
// categories. Rate-limited server-side at 10/hour.

const ANON_CATEGORIES: SupportCategory[] = ["bug", "feature_request"];
const AUTHED_CATEGORIES: SupportCategory[] = [
  "account",
  "billing",
  "bug",
  "feature_request",
  "emergency_followup",
];

type Props = {
  /**
   * When true, the widget renders in anon mode regardless of auth state —
   * used on the public landing where we don't want the category list
   * broadening if a session happens to exist.
   */
  forceAnon?: boolean;
};

export function SupportWidget({ forceAnon = false }: Props) {
  const session = useAuthStore((s) => s.session);
  const profileEmail = useAuthStore((s) => s.profile?.email ?? null);
  const isAnon = forceAnon || !session;

  const categories = isAnon ? ANON_CATEGORIES : AUTHED_CATEGORIES;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportCategory>(categories[0]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!subject.trim() || !body.trim()) return false;
    if (isAnon && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) return false;
    return true;
  }, [submitting, subject, body, isAnon, contactEmail]);

  function reset() {
    setCategory(categories[0]);
    setSubject("");
    setBody("");
    setContactEmail("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const input: SubmitSupportTicketInput = {
        category,
        subject: subject.trim(),
        body: body.trim(),
        contact_email: (isAnon ? contactEmail.trim() : profileEmail) || null,
      };
      await submitSupportTicket(input);
      notify.success("Thanks — we'll reply within one business day.");
      reset();
      setOpen(false);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "rate_limited") {
        notify.error("Too many tickets from this session. Please try again in an hour.");
      } else {
        notify.error(e.message || "Couldn't submit your ticket.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          aria-label="Open support"
          className="fixed bottom-20 right-4 z-40 h-12 w-12 rounded-full p-0 shadow-lg sm:bottom-6"
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Get in touch</SheetTitle>
          <SheetDescription>
            {isAnon
              ? "Report a bug or suggest a feature — we read every message."
              : "Question about billing, your account, or a bug? We'll reply within one business day."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="support-category">Category</Label>
            <select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportCategory)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {SUPPORT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>

          {isAnon ? (
            <div className="space-y-2">
              <Label htmlFor="support-email">Your email</Label>
              <Input
                id="support-email"
                type="email"
                autoComplete="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="support-subject">Subject</Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="Short summary"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-body">Details</Label>
            <Textarea
              id="support-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
              placeholder="What happened, what you expected, and any steps to reproduce."
              rows={6}
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { reset(); setOpen(false); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Sending…" : "Send ticket"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
