import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ADMIN_USERS_QUERY_KEY,
  downloadAdminUsersCsv,
  searchAdminUsers,
  type AdminUserRow,
} from "@/lib/admin";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

type RoleFilter = "" | "owner" | "trainer" | "silver_lining";

// UsersIndex — /admin/users
//
// Searchable directory sourced from GET /api/admin/users. Worker writes
// one `admin.user.search` audit row per request and a separate
// `admin.user.export_csv` row for the CSV download.

export default function UsersIndex() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<RoleFilter>("");
  const [page, setPage] = useState(0);

  const usersQ = useQuery({
    queryKey: [...ADMIN_USERS_QUERY_KEY, { q, role, page }] as const,
    queryFn: () => searchAdminUsers({ q, role, page }),
    // Keep the previous page visible while the next one loads — the
    // table shouldn't flash empty between pages.
    placeholderData: (previous) => previous,
  });

  const csvM = useMutation({
    mutationFn: downloadAdminUsersCsv,
    onSuccess: () => notify.success("users.csv downloaded"),
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const rows = usersQ.data?.rows ?? [];
  const total = usersQ.data?.total ?? 0;
  const limit = usersQ.data?.limit ?? 50;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">Users</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Owner, trainer, and admin accounts. Email search is case-insensitive.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => csvM.mutate()}
          disabled={csvM.isPending}
        >
          {csvM.isPending ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
            }}
          >
            <div className="min-w-[240px] flex-1">
              <label className="text-xs text-muted-foreground">Email</label>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="cedric@…"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Role</label>
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as RoleFilter);
                  setPage(0);
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All roles</option>
                <option value="owner">Owner</option>
                <option value="trainer">Trainer</option>
                <option value="silver_lining">Silver Lining</option>
              </select>
            </div>
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      {usersQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn't load users. {mapSupabaseError(usersQ.error as Error)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersQ.isLoading && rows.length === 0 ? (
                  <LoadingRow />
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No users match.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((u) => <UserRow key={u.user_id} u={u} />)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          {total.toLocaleString()} {total === 1 ? "user" : "users"}
          {pages > 1 ? ` · page ${page + 1} of ${pages}` : ""}
        </div>
        {pages > 1 ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UserRow({ u }: { u: AdminUserRow }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{u.email}</TableCell>
      <TableCell>{u.display_name}</TableCell>
      <TableCell className="capitalize">{u.role.replace("_", " ")}</TableCell>
      <TableCell className="capitalize">{u.status.replace("_", " ")}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {new Date(u.created_at).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}

function LoadingRow() {
  return (
    <TableRow>
      <TableCell colSpan={5} className="py-6">
        <div className="h-6 w-full animate-pulse rounded bg-muted/50" />
      </TableCell>
    </TableRow>
  );
}
