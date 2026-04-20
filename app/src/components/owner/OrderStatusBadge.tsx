import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/lib/orders";

// Single source of truth for the paid/failed/refunded/processing
// mapping so the orders list, detail, and success pages stay in lockstep.
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case "paid":
      return (
        <Badge className="bg-accent text-accent-foreground hover:bg-accent">
          Paid
        </Badge>
      );
    case "refunded":
      return <Badge variant="secondary">Refunded</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "awaiting_merchant_setup":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Processing
        </Badge>
      );
    case "pending_payment":
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}
