import { PinSettings } from "../../components/PinSettings";
import { BrandingSection } from "../../components/trainer/account/BrandingSection";
import { InvoiceDefaultsSection } from "../../components/trainer/account/InvoiceDefaultsSection";

// TrainerAccount — /trainer/account.
//
// Hosts the PIN-change flow plus the Phase 7 "business in a box"
// invoice-branding controls: logo, brand color, and the monthly
// invoice defaults (net days, auto-finalize day, footer memo).
// Stripe Connect onboarding lives on /trainer/payouts.
export default function TrainerAccount() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your sign-in PIN and the branding on the invoices you
          send. Payout onboarding lives on the Payouts tab.
        </p>
      </div>
      <BrandingSection />
      <InvoiceDefaultsSection />
      <PinSettings />
    </div>
  );
}
