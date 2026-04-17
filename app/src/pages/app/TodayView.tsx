import { useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@heroui/react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnimalCard } from "@/components/owner/AnimalCard";
import {
  ANIMALS_QUERY_KEY,
  ATTENTION_QUERY_KEY,
  attentionAnimalIds,
  listAnimals,
} from "@/lib/animals";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";

// TodayView — /app. The first screen an owner sees each morning.
//
// - Loads only active (non-archived) animals.
// - Cross-references animals with vet_records expiring within 30 days
//   to compute the per-card "Due soon" flag and the header badge.
// - Cards enter staggered on first mount only — on a back-nav, the
//   `seenBeforeRef` is already true and we skip the animation so the
//   screen doesn't feel "busy" every return.
export default function TodayView() {
  const navigate = useNavigate();
  const seenBeforeRef = useRef(false);

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }],
    queryFn: () => listAnimals({ includeArchived: false }),
  });

  const attentionQuery = useQuery({
    queryKey: ATTENTION_QUERY_KEY,
    queryFn: () => attentionAnimalIds(30),
  });

  if (animalsQuery.isError) {
    notify.error(mapSupabaseError(animalsQuery.error as Error));
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const animals = animalsQuery.data ?? [];
  const attentionSet = attentionQuery.data ?? new Set<string>();
  const attentionCount = useMemo(
    () => animals.filter((a) => attentionSet.has(a.id)).length,
    [animals, attentionSet]
  );

  const shouldAnimate = !seenBeforeRef.current;
  if (animalsQuery.isSuccess) seenBeforeRef.current = true;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Today</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        {attentionCount > 0 ? (
          <Badge variant="outline" className="border-[#C4552B] text-[#C4552B]">
            {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
          </Badge>
        ) : null}
      </header>

      {animalsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner color="primary" label="Loading your barn…" />
        </div>
      ) : animals.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.ul
          className="space-y-3"
          initial={shouldAnimate ? "hidden" : false}
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {animals.map((a) => (
            <motion.li
              key={a.id}
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
              }}
            >
              <AnimalCard
                id={a.id}
                name={a.barn_name}
                species={a.species}
                breed={a.breed}
                photoUrl={null}
                todaysSnapshot={{ protocolCount: 0, recentRecords: 0 }}
                hasFlag={attentionSet.has(a.id)}
                onPress={(id) => navigate(`/app/animals/${id}`)}
              />
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Let's get your barn on the board.</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Add your first animal and this view becomes your morning dashboard.
        </p>
        <Button asChild size="sm">
          <Link to="/app/animals/new">
            <Plus size={16} />
            Add your first animal
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
