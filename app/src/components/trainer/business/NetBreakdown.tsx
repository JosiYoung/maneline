import { formatCentsUsd } from "@/lib/expenses";

interface Props {
  grossCents: number;
  platformFeeCents: number;
  stripeFeeCentsEst: number;
  netCents: number;
}

export function NetBreakdown({
  grossCents,
  platformFeeCents,
  stripeFeeCentsEst,
  netCents,
}: Props) {
  return (
    <div className="space-y-1.5">
      <Row label="Gross" value={grossCents} />
      <Row label="Platform fee" value={-platformFeeCents} muted />
      <Row label="Stripe fee (est.)" value={-stripeFeeCentsEst} muted />
      <div className="my-1 border-t border-border/60" />
      <Row label="Net to you" value={netCents} bold />
      <p className="pt-1 text-[10px] leading-tight text-muted-foreground">
        Stripe processing fees are estimated at 2.9% + $0.30 per charge;
        the exact amount is deducted by Stripe before payout.
      </p>
    </div>
  );
}

function Row({
  label, value, muted, bold,
}: { label: string; value: number; muted?: boolean; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className={bold ? "font-semibold text-foreground" : ""}>
        {formatCentsUsd(value)}
      </span>
    </div>
  );
}
