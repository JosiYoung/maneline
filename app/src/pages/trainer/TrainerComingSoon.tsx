import { Card, CardContent } from "@/components/ui/card";

// TrainerComingSoon — shared scaffold for /trainer routes that 2.2 wires
// into the nav before their real page lands. Each subsequent Phase 2
// prompt (2.3 Clients, 2.5 Sessions, 2.6 Payouts/Account) swaps its
// route target from this placeholder to the feature component.
export default function TrainerComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This surface is being built in Phase 2. Check back shortly.
        </p>
      </div>

      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing to show here yet.
        </CardContent>
      </Card>
    </div>
  );
}
