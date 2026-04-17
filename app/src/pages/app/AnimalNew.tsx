import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

import { AnimalForm } from "@/components/owner/AnimalForm";

// AnimalNew — /app/animals/new
export default function AnimalNew() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          to="/app/animals"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={16} />
          Animals
        </Link>
        <h1 className="font-display text-2xl text-primary">Add an animal</h1>
        <p className="text-sm text-muted-foreground">
          Just a barn name is required. You can fill the rest in later.
        </p>
      </header>

      <AnimalForm mode="create" />
    </div>
  );
}
