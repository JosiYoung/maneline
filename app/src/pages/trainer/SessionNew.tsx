import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

import { SessionForm } from "@/components/trainer/SessionForm";

// SessionNew — /trainer/sessions/new?animal=:id
//
// If the trainer opens the form from an animal's page, pre-select it.
export default function SessionNew() {
  const [params] = useSearchParams();
  const preselectAnimal = params.get("animal");

  return (
    <div className="space-y-6">
      <Link
        to="/trainer/sessions"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Sessions
      </Link>

      <header>
        <h1 className="font-display text-3xl text-primary">Log a session</h1>
        <p className="text-sm text-muted-foreground">
          The owner sees this as soon as you save — no approval needed.
        </p>
      </header>

      <SessionForm defaultAnimalId={preselectAnimal} />
    </div>
  );
}
