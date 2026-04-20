import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ADMIN_SUPPORT_TICKETS_QUERY_KEY,
  SUPPORT_CATEGORY_LABEL,
  type AdminSupportTicketRow,
  type SupportStatus,
  claimSupportTicket,
  listAdminSupportTickets,
  resolveSupportTicket,
} from "@/lib/support";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";

// SupportTicketsIndex — /admin/support
//
// Phase 5.4. Lists tickets with a status filter (default: Open queue).
// Silver Lining admins claim a ticket (stamps assignee_id +
// first_response_at) and resolve it (stamps resolved_at). Every read +
// write goes through the Worker and writes an audit_log row.

type StatusFilter = SupportStatus | "all";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "claimed", label: "Claimed" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const STATUS_LABEL: Record<SupportStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  resolved: "Resolved",
  archived: "Archived",
};

export default function SupportTicketsIndex() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: [...ADMIN_SUPPORT_TICKETS_QUERY_KEY, { status }] as const,
    queryFn: () => listAdminSupportTickets(status),
    refetchInterval: 30_000,
  });

  const claimM = useMutation({
    mutationFn: (id: string) => claimSupportTicket(id),
    onSuccess: (row) => {
      notify.success(`Claimed ticket from ${displayContact(row)}`);
      qc.invalidateQueries({ queryKey: ADMIN_SUPPORT_TICKETS_QUERY_KEY });
    },
    onError: (err: Error) => notify.error(mapSupabaseError(err)),
  });

  const resolveM = useMutation({
    mutationFn: (id: string) => resolveSupportTicket(id),
    onSuccess: (row) => {
      notify.success(`Resolved ticket from ${displayContact(row)}`);
      qc.invalidateQueries({ queryKey: ADMIN_SUPPORT_TICKETS_QUERY_KEY });
    },
    onError: (err: Error) => notify.error(mapSupabaseError(err)),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Support inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tickets posted from the owner, trainer, admin widgets and the public landing.
          Claim to signal ownership; resolve when the thread is closed.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={status === f.value ? "default" : "outline"}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {listQ.isLoading ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn't load tickets. {mapSupabaseError(listQ.error as Error)}
          </CardContent>
        </Card>
      ) : !listQ.data || listQ.data.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No tickets match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.data.map((row) => {
                  const isOpen = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpandedId(isOpen ? null : row.id)}
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">{displayContact(row)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{SUPPORT_CATEGORY_LABEL[row.category]}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-sm">
                          {row.subject}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.status === "open" ? "default" : "secondary"}>
                            {STATUS_LABEL[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.assignee_display_name || row.assignee_email || "—"}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.status === "open" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => claimM.mutate(row.id)}
                              disabled={claimM.isPending}
                            >
                              Claim
                            </Button>
                          ) : null}
                          {row.status === "claimed" ? (
                            <Button
                              size="sm"
                              onClick={() => resolveM.mutate(row.id)}
                              disabled={resolveM.isPending}
                            >
                              Resolve
                            </Button>
                          ) : null}
                          {row.status === "resolved" || row.status === "archived" ? (
                            <span className="text-xs text-muted-foreground">Done</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="whitespace-pre-wrap text-sm">{row.body}</div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              Ticket {row.id}
                              {row.first_response_at ? ` · Claimed ${new Date(row.first_response_at).toLocaleString()}` : ""}
                              {row.resolved_at ? ` · Resolved ${new Date(row.resolved_at).toLocaleString()}` : ""}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function displayContact(row: AdminSupportTicketRow): string {
  return (
    row.owner_display_name ||
    row.owner_email ||
    row.contact_email ||
    "anonymous"
  );
}
