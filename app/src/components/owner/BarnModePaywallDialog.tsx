import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Hard paywall — triggered when the owner tries to add a 6th horse on
// free tier. Intentionally has NO dismiss-via-outside-click so the user
// must choose: go to Subscription, or Cancel and stay on 5 horses.
export function BarnModePaywallDialog({
  open,
  onClose,
  currentHorseCount,
}: {
  open: boolean;
  onClose: () => void;
  currentHorseCount: number | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Barn Mode required</DialogTitle>
          <DialogDescription>
            You're tracking {currentHorseCount ?? 5} horses — the free tier
            limit. Upgrade to Barn Mode for unlimited horses, Barn Calendar,
            Herd Health PDF exports, Facility Map, and Barn Spending rollups.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button asChild onClick={onClose}>
            <Link to="/app/settings/subscription">See Barn Mode</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
