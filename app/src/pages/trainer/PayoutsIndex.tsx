import { ConnectOnboardCard } from "@/components/trainer/ConnectOnboardCard";

// PayoutsIndex — /trainer/payouts.
//
// Today this is a single ConnectOnboardCard. When Prompt 2.8 lands we'll
// surface the owner's session_payment rows pending transfer here too so
// the trainer has one place to watch money-in-flight.
export default function PayoutsIndex() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Payouts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your Stripe account so Mane Line can route session payments to
          you. You can keep logging sessions while setup finishes.
        </p>
      </div>

      <ConnectOnboardCard />
    </div>
  );
}
