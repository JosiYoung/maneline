import { Link } from "react-router-dom";
import { CreditCard, ChevronRight } from "lucide-react";
import { PinSettings } from "../../components/PinSettings";
import { Card, CardContent } from "@/components/ui/card";

// Settings — /app/settings. Not in BottomNav (we keep that to four
// owner-primary slots). Reached from PortalHeader in a later phase.
export default function Settings() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-primary">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account preferences, PIN-login, and subscription.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <Link
            to="/app/settings/subscription"
            className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <div>
                <div className="font-medium">Subscription</div>
                <div className="text-xs text-muted-foreground">
                  Barn Mode plan, billing, promo codes.
                </div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <PinSettings />
    </div>
  );
}
