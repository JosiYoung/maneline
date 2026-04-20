import { Avatar, Card, CardBody, Chip } from "@heroui/react";
import { AlertTriangle, ChevronRight } from "lucide-react";

// AnimalCard — the marquee tile on /app (Today). HeroUI — not shadcn —
// per FRONTEND-UI-GUIDE §4.2 / §4.3: the Owner Portal is the one
// surface where HeroUI lives, and the AnimalCard is where that
// tactile, "gift-wrapped" feel has to come through.
export type AnimalCardProps = {
  id: string;
  name: string;
  species: "horse" | "dog";
  breed: string | null;
  photoUrl?: string | null;
  // Phase-1 stubs for todaysSnapshot. Protocol confirmations UI comes
  // in Phase 2, so we intentionally render "N active" text (no
  // checkboxes) — see plan §1.5 "render as 'Protocols: N active' text".
  todaysSnapshot: {
    protocolCount: number;
    recentRecords: number;
    dosesDueToday?: number;
  };
  hasFlag: boolean;
  onPress: (id: string) => void;
};

export function AnimalCard(props: AnimalCardProps) {
  const { id, name, species, breed, photoUrl, todaysSnapshot, hasFlag, onPress } = props;

  return (
    <Card
      isPressable
      onPress={() => onPress(id)}
      aria-label={`Open ${name}`}
      role="button"
      className="w-full bg-card border border-border data-[hover=true]:border-primary data-[hover=true]:shadow-md"
      shadow="none"
      radius="lg"
    >
      <CardBody className="flex flex-row items-center gap-4 p-4">
        <Avatar
          src={photoUrl ?? undefined}
          name={name.charAt(0).toUpperCase()}
          className="h-14 w-14 shrink-0"
          classNames={{
            base: "bg-muted text-primary",
            name: "font-display text-lg",
          }}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-lg text-foreground">{name}</h3>
            {hasFlag ? (
              <Chip
                size="sm"
                startContent={<AlertTriangle size={12} />}
                className="bg-[#C4552B1A] text-[#C4552B]"
                variant="flat"
              >
                Due soon
              </Chip>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[capitalize(species), breed].filter(Boolean).join(" · ")}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="flat" className="bg-muted text-foreground">
              Protocols: {todaysSnapshot.protocolCount} active
            </Chip>
            {todaysSnapshot.dosesDueToday && todaysSnapshot.dosesDueToday > 0 ? (
              <Chip
                size="sm"
                variant="flat"
                className="bg-[#C4552B1A] text-[#C4552B]"
              >
                {todaysSnapshot.dosesDueToday} dose
                {todaysSnapshot.dosesDueToday === 1 ? "" : "s"} due
              </Chip>
            ) : null}
            <Chip size="sm" variant="flat" className="bg-muted text-foreground">
              Records: {todaysSnapshot.recentRecords}
            </Chip>
          </div>
        </div>

        <ChevronRight className="shrink-0 text-muted-foreground" size={20} />
      </CardBody>
    </Card>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
