import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { listAnimals, type Animal, ANIMALS_QUERY_KEY } from "@/lib/animals";
import {
  CARE_MATRIX_COLUMNS,
  CARE_MATRIX_QUERY_KEY,
  FACILITY_MAP_QUERY_KEY,
  FACILITY_RANCHES_QUERY_KEY,
  addTurnoutMembers,
  archiveStall,
  archiveTurnoutGroup,
  assignStall,
  createRanch,
  createStall,
  createTurnoutGroup,
  formatCareMatrixColumn,
  getCareMatrix,
  getFacilityMap,
  listFacilityRanches,
  removeTurnoutMember,
  upsertCareMatrix,
  type CareMatrixColumn,
  type CareMatrixEntry,
  type Stall,
  type StallAssignment,
  type TurnoutGroup,
  type TurnoutGroupMember,
} from "@/lib/barn";
import { BarnSubNav } from "@/components/owner/BarnSubNav";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

// BarnFacility — /app/barn/facility.
//
// Stalls / Turnout / Daily Care tabs over the Facility Map.
// Ranch selector up top; all writes flow through the Worker.
// No drag-and-drop yet (TECH_DEBT phase-8:03-02); assignment is done
// via a pick-list dialog so the core CRUD loop is usable.

export default function BarnFacility() {
  const qc = useQueryClient();

  const ranchesQ = useQuery({
    queryKey: FACILITY_RANCHES_QUERY_KEY,
    queryFn: listFacilityRanches,
  });

  const ranches = ranchesQ.data ?? [];
  const [ranchId, setRanchId] = useState<string>("");
  const [addRanchOpen, setAddRanchOpen] = useState(false);

  useEffect(() => {
    if (!ranchId && ranches.length > 0) {
      setRanchId(ranches[0].id);
    }
  }, [ranchId, ranches]);

  const animalsQ = useQuery({
    queryKey: ANIMALS_QUERY_KEY,
    queryFn: () => listAnimals(),
  });

  const animals = animalsQ.data ?? [];

  return (
    <div className="space-y-6">
      <BarnSubNav />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-primary">Facility map</h1>
          <p className="text-sm text-muted-foreground">
            Stalls, turnout groups, and the daily care matrix.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="ranch-select" className="text-sm">
            Ranch:
          </Label>
          {ranchesQ.isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <select
              id="ranch-select"
              value={ranchId}
              onChange={(e) => {
                setRanchId(e.target.value);
                qc.invalidateQueries({
                  queryKey: ["facility", "map"],
                });
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={ranches.length === 0}
            >
              {ranches.length === 0 ? (
                <option value="">No ranches</option>
              ) : (
                ranches.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))
              )}
            </select>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddRanchOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            New ranch
          </Button>
        </div>
      </header>

      {ranchesQ.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {mapSupabaseError(ranchesQ.error as Error)}
          </CardContent>
        </Card>
      ) : !ranchId ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            {ranchesQ.isLoading ? (
              "Loading ranches…"
            ) : (
              <>
                <p>No ranches yet.</p>
                <Button onClick={() => setAddRanchOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add your first ranch
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="stalls" className="w-full">
          <TabsList>
            <TabsTrigger value="stalls">Stalls</TabsTrigger>
            <TabsTrigger value="turnout">Turnout</TabsTrigger>
            <TabsTrigger value="care">Daily care</TabsTrigger>
          </TabsList>
          <TabsContent value="stalls">
            <StallsTab ranchId={ranchId} animals={animals} />
          </TabsContent>
          <TabsContent value="turnout">
            <TurnoutTab ranchId={ranchId} animals={animals} />
          </TabsContent>
          <TabsContent value="care">
            <CareMatrixTab ranchId={ranchId} animals={animals} />
          </TabsContent>
        </Tabs>
      )}

      <CreateRanchDialog
        open={addRanchOpen}
        onClose={() => setAddRanchOpen(false)}
        onCreated={(created) => {
          qc.invalidateQueries({ queryKey: FACILITY_RANCHES_QUERY_KEY });
          setRanchId(created.id);
        }}
      />
    </div>
  );
}

function CreateRanchDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ranch: { id: string; name: string; color_hex: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Ranch name is required.");
      return createRanch({
        name: trimmed,
        address: address.trim() || null,
        city: city.trim() || null,
        state: stateRegion.trim() || null,
      });
    },
    onSuccess: (ranch) => {
      notify.success("Ranch added");
      onCreated(ranch);
      setName("");
      setAddress("");
      setCity("");
      setStateRegion("");
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add ranch</DialogTitle>
          <DialogDescription>
            Create a ranch to organize stalls, turnout, and daily care.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ranch-name">Name</Label>
            <Input
              id="ranch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ranch-address">Address (optional)</Label>
            <Input
              id="ranch-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ranch-city">City</Label>
              <Input
                id="ranch-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ranch-state">State</Label>
              <Input
                id="ranch-state"
                value={stateRegion}
                onChange={(e) => setStateRegion(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !name.trim()}>
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Stalls tab ----------

function StallsTab({ ranchId, animals }: { ranchId: string; animals: Animal[] }) {
  const qc = useQueryClient();
  const mapQ = useQuery({
    queryKey: FACILITY_MAP_QUERY_KEY(ranchId),
    queryFn: () => getFacilityMap(ranchId),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [assignStallId, setAssignStallId] = useState<string | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: FACILITY_MAP_QUERY_KEY(ranchId) });
  }

  if (mapQ.isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (mapQ.isError || !mapQ.data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {mapSupabaseError(mapQ.error as Error)}
        </CardContent>
      </Card>
    );
  }

  const { stalls, assignments } = mapQ.data;
  const assignedStallIds = new Set(
    assignments.filter((a) => !a.unassigned_at).map((a) => a.stall_id)
  );
  const assignedByStall = new Map<string, StallAssignment>();
  for (const a of assignments) {
    if (!a.unassigned_at) assignedByStall.set(a.stall_id, a);
  }
  const animalsById = new Map(animals.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {stalls.length} stall{stalls.length === 1 ? "" : "s"} · {assignedStallIds.size} occupied
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add stall
        </Button>
      </div>

      {stalls.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No stalls yet. Add one to start assigning horses.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {stalls.map((s) => {
            const assign = assignedByStall.get(s.id);
            const horse = assign ? animalsById.get(assign.animal_id) : null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setAssignStallId(s.id)}
                className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition hover:border-primary/60 hover:bg-secondary/30 ${
                  horse ? "border-emerald-500/40 bg-emerald-50/50" : "border-border"
                }`}
              >
                <span className="text-sm font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">
                  {horse ? horse.barn_name : "Empty"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <CreateStallDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        ranchId={ranchId}
        onCreated={invalidate}
      />

      <AssignStallDialog
        stallId={assignStallId}
        stalls={stalls}
        assignedByStall={assignedByStall}
        animals={animals}
        onClose={() => setAssignStallId(null)}
        onChanged={invalidate}
      />
    </div>
  );
}

function CreateStallDialog({
  open,
  onClose,
  ranchId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  ranchId: string;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const trimmed = label.trim();
      if (!trimmed) throw new Error("Label is required.");
      return createStall({
        ranch_id: ranchId,
        label: trimmed,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      notify.success("Stall added");
      onCreated();
      setLabel("");
      setNotes("");
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add stall</DialogTitle>
          <DialogDescription>Give it a label (e.g. &quot;A-1&quot;).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="stall-label">Label</Label>
            <Input
              id="stall-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="stall-notes">Notes (optional)</Label>
            <Textarea
              id="stall-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !label.trim()}>
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignStallDialog({
  stallId,
  stalls,
  assignedByStall,
  animals,
  onClose,
  onChanged,
}: {
  stallId: string | null;
  stalls: Stall[];
  assignedByStall: Map<string, StallAssignment>;
  animals: Animal[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pick, setPick] = useState<string>("");

  useEffect(() => {
    if (!stallId) return;
    const current = assignedByStall.get(stallId);
    setPick(current ? current.animal_id : "");
  }, [stallId, assignedByStall]);

  const stall = stallId ? stalls.find((s) => s.id === stallId) ?? null : null;
  const current = stall ? assignedByStall.get(stall.id) : null;
  const currentHorse = current ? animals.find((a) => a.id === current.animal_id) : null;

  // Occupied animals in other stalls are shown with a warning prefix,
  // but can still be picked — the Worker will unassign their old stall.
  const occupiedElsewhere = new Set<string>();
  for (const [sid, a] of assignedByStall.entries()) {
    if (sid !== stallId) occupiedElsewhere.add(a.animal_id);
  }

  const assign = useMutation({
    mutationFn: async () => {
      if (!stall) throw new Error("no stall");
      return assignStall(stall.id, pick || null);
    },
    onSuccess: () => {
      notify.success(pick ? "Stall assigned" : "Stall cleared");
      onChanged();
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const arch = useMutation({
    mutationFn: async () => {
      if (!stall) throw new Error("no stall");
      return archiveStall(stall.id);
    },
    onSuccess: () => {
      notify.success("Stall archived");
      onChanged();
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Dialog open={Boolean(stallId)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        {stall && (
          <>
            <DialogHeader>
              <DialogTitle>Stall {stall.label}</DialogTitle>
              <DialogDescription>
                {currentHorse
                  ? `Currently: ${currentHorse.barn_name}`
                  : "Currently empty."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="assign-pick">Assign horse</Label>
                <select
                  id="assign-pick"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Empty (unassign) —</option>
                  {animals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.barn_name}
                      {occupiedElsewhere.has(a.id) ? " (in another stall)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.confirm(`Archive stall ${stall.label}?`)) arch.mutate();
                }}
                disabled={arch.isPending}
              >
                {arch.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                <Trash2 className="mr-1 h-4 w-4" />
                Archive
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>
                  Cancel
                </Button>
                <Button onClick={() => assign.mutate()} disabled={assign.isPending}>
                  {assign.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Turnout tab ----------

function TurnoutTab({ ranchId, animals }: { ranchId: string; animals: Animal[] }) {
  const qc = useQueryClient();
  const mapQ = useQuery({
    queryKey: FACILITY_MAP_QUERY_KEY(ranchId),
    queryFn: () => getFacilityMap(ranchId),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: FACILITY_MAP_QUERY_KEY(ranchId) });
  }

  if (mapQ.isLoading) return <Skeleton className="h-48 w-full" />;
  if (mapQ.isError || !mapQ.data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {mapSupabaseError(mapQ.error as Error)}
        </CardContent>
      </Card>
    );
  }

  const { groups, members } = mapQ.data;
  const activeMembersByGroup = new Map<string, TurnoutGroupMember[]>();
  for (const m of members) {
    if (m.left_at) continue;
    const arr = activeMembersByGroup.get(m.group_id) ?? [];
    arr.push(m);
    activeMembersByGroup.set(m.group_id, arr);
  }
  const animalsById = new Map(animals.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {groups.length} turnout group{groups.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add group
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No turnout groups yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => {
            const mems = activeMembersByGroup.get(g.id) ?? [];
            return (
              <Card key={g.id} className="cursor-pointer" onClick={() => setEditGroupId(g.id)}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    {g.color_hex && (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-full border border-border"
                        style={{ background: g.color_hex }}
                      />
                    )}
                    <CardTitle className="text-base">{g.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {mems.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No horses in group.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {mems.map((m) => (
                        <Badge key={m.id} variant="outline" className="text-xs">
                          {animalsById.get(m.animal_id)?.barn_name ?? "?"}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateTurnoutGroupDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        ranchId={ranchId}
        onCreated={invalidate}
      />

      <TurnoutGroupEditorDialog
        groupId={editGroupId}
        groups={groups}
        members={members}
        animals={animals}
        onClose={() => setEditGroupId(null)}
        onChanged={invalidate}
      />
    </div>
  );
}

function CreateTurnoutGroupDialog({
  open,
  onClose,
  ranchId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  ranchId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name is required.");
      return createTurnoutGroup({
        ranch_id: ranchId,
        name: trimmed,
        color_hex: color || null,
      });
    },
    onSuccess: () => {
      notify.success("Group added");
      onCreated();
      setName("");
      setColor("");
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New turnout group</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tg-name">Name</Label>
            <Input
              id="tg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tg-color">Color (optional)</Label>
            <Input
              id="tg-color"
              type="color"
              value={color || "#b4cf5d"}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-20 p-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !name.trim()}>
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TurnoutGroupEditorDialog({
  groupId,
  groups,
  members,
  animals,
  onClose,
  onChanged,
}: {
  groupId: string | null;
  groups: TurnoutGroup[];
  members: TurnoutGroupMember[];
  animals: Animal[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pick, setPick] = useState<string>("");

  const group = groupId ? groups.find((g) => g.id === groupId) ?? null : null;
  const activeMembers = group
    ? members.filter((m) => m.group_id === group.id && !m.left_at)
    : [];
  const activeIds = new Set(activeMembers.map((m) => m.animal_id));
  const candidates = animals.filter((a) => !activeIds.has(a.id));

  useEffect(() => {
    setPick("");
  }, [groupId]);

  const add = useMutation({
    mutationFn: async () => {
      if (!group) throw new Error("no group");
      if (!pick) throw new Error("pick an animal");
      return addTurnoutMembers(group.id, [pick]);
    },
    onSuccess: () => {
      notify.success("Added to group");
      setPick("");
      onChanged();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const remove = useMutation({
    mutationFn: async (animalId: string) => {
      if (!group) throw new Error("no group");
      return removeTurnoutMember(group.id, animalId);
    },
    onSuccess: () => {
      notify.success("Removed from group");
      onChanged();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const arch = useMutation({
    mutationFn: async () => {
      if (!group) throw new Error("no group");
      return archiveTurnoutGroup(group.id);
    },
    onSuccess: () => {
      notify.success("Group archived");
      onChanged();
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Dialog open={Boolean(groupId)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        {group && (
          <>
            <DialogHeader>
              <DialogTitle>{group.name}</DialogTitle>
              <DialogDescription>
                {activeMembers.length} horse{activeMembers.length === 1 ? "" : "s"} in group.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Members</Label>
                {activeMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Empty.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeMembers.map((m) => {
                      const horse = animals.find((a) => a.id === m.animal_id);
                      return (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2 py-1 text-xs"
                        >
                          {horse?.barn_name ?? "?"}
                          <button
                            type="button"
                            onClick={() => remove.mutate(m.animal_id)}
                            disabled={remove.isPending}
                            aria-label="Remove"
                            className="text-muted-foreground hover:text-rose-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="tg-add">Add horse</Label>
                <div className="flex gap-2">
                  <select
                    id="tg-add"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Pick a horse —</option>
                    {candidates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.barn_name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    onClick={() => add.mutate()}
                    disabled={add.isPending || !pick}
                  >
                    {add.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Add
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.confirm(`Archive group "${group.name}"?`)) arch.mutate();
                }}
                disabled={arch.isPending}
              >
                {arch.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                <Trash2 className="mr-1 h-4 w-4" />
                Archive
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Care matrix tab ----------

function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type DraftRow = Record<CareMatrixColumn, boolean> & { notes: string };

function rowFromEntry(e: CareMatrixEntry): DraftRow {
  return {
    feed_am: e.feed_am,
    feed_pm: e.feed_pm,
    hay: e.hay,
    turnout: e.turnout,
    blanket: e.blanket,
    supplements_given: e.supplements_given,
    meds_given: e.meds_given,
    notes: e.notes ?? "",
  };
}

function blankRow(): DraftRow {
  return {
    feed_am: false,
    feed_pm: false,
    hay: false,
    turnout: false,
    blanket: false,
    supplements_given: false,
    meds_given: false,
    notes: "",
  };
}

function CareMatrixTab({ ranchId, animals }: { ranchId: string; animals: Animal[] }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(todayYmd());

  const cmQ = useQuery({
    queryKey: CARE_MATRIX_QUERY_KEY(ranchId, date),
    queryFn: () => getCareMatrix(ranchId, date),
  });

  const animalsById = useMemo(
    () => new Map(animals.map((a) => [a.id, a])),
    [animals]
  );

  const [draft, setDraft] = useState<Record<string, DraftRow>>({});

  useEffect(() => {
    if (!cmQ.data) return;
    const seed: Record<string, DraftRow> = {};
    for (const id of cmQ.data.animal_ids) {
      const existing = cmQ.data.entries.find((e) => e.animal_id === id);
      seed[id] = existing ? rowFromEntry(existing) : blankRow();
    }
    setDraft(seed);
  }, [cmQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!cmQ.data) throw new Error("no data");
      const entries = cmQ.data.animal_ids.map((id) => ({
        animal_id: id,
        ...draft[id],
      }));
      return upsertCareMatrix(ranchId, date, entries);
    },
    onSuccess: () => {
      notify.success("Saved");
      qc.invalidateQueries({ queryKey: CARE_MATRIX_QUERY_KEY(ranchId, date) });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function toggle(animalId: string, col: CareMatrixColumn) {
    setDraft((d) => ({
      ...d,
      [animalId]: { ...d[animalId], [col]: !d[animalId][col] },
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <Label htmlFor="cm-date">Date</Label>
          <Input
            id="cm-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !cmQ.data}
          size="sm"
        >
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>

      {cmQ.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : cmQ.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {mapSupabaseError(cmQ.error as Error)}
          </CardContent>
        </Card>
      ) : !cmQ.data || cmQ.data.animal_ids.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No horses are currently assigned to stalls at this ranch.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Horse</th>
                  {CARE_MATRIX_COLUMNS.map((c) => (
                    <th key={c} className="px-2 py-2 text-center font-medium">
                      {formatCareMatrixColumn(c)}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {cmQ.data.animal_ids.map((id) => {
                  const row = draft[id] ?? blankRow();
                  const horse = animalsById.get(id);
                  return (
                    <tr key={id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {horse?.barn_name ?? "?"}
                      </td>
                      {CARE_MATRIX_COLUMNS.map((c) => (
                        <td key={c} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row[c]}
                            onChange={() => toggle(id, c)}
                            className="h-4 w-4 rounded border border-input"
                            aria-label={`${horse?.barn_name ?? id} ${c}`}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <Input
                          value={row.notes}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [id]: { ...row, notes: e.target.value },
                            }))
                          }
                          maxLength={1000}
                          placeholder="—"
                          className="h-8 text-xs"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
