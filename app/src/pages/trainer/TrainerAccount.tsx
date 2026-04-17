import { PinSettings } from "../../components/PinSettings";

// TrainerAccount — /trainer/account.
//
// Phase 2 Prompt 2.2 stub: hosts the existing PinSettings surface from
// Phase 0 so trainers can still manage their login PIN. Prompt 2.6 adds
// Stripe Connect onboarding and fee visibility next to this block.
export default function TrainerAccount() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your sign-in PIN. Stripe payout onboarding lands here next.
        </p>
      </div>
      <PinSettings />
    </div>
  );
}
