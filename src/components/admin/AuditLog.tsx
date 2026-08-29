import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ACTION_LABELS, ROLE_LABELS, type AppRole, type AuditEntry } from "@/lib/admin";
import { TABS } from "@/components/shell/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function roleLabel(role: AppRole | null): string {
  return role ? ROLE_LABELS[role] : "—";
}

function routeLabel(entry: AuditEntry): string {
  if (!entry.route) return "—";
  return TABS.find((t) => t.id === entry.route)?.label ?? entry.route;
}

export function AuditLog() {
  const q = useQuery({
    queryKey: ["role-audit"],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from("role_audit_log")
        .select("id, action, target_email, actor_email, previous_role, new_role, route, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as AuditEntry[];
    },
  });

  if (q.isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Carregando histórico...</p>
    );
  }

  if (q.isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">{adminErrorMessage(q.error)}</p>
    );
  }

  const entries = q.data ?? [];

  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma alteração registrada.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Quando</TableHead>
            <TableHead className="w-28">Ação</TableHead>
            <TableHead>Alvo</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead className="w-44">Mudança</TableHead>
            <TableHead className="w-32">Rota</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(e.created_at).toLocaleString("pt-BR")}
              </TableCell>
              <TableCell className="text-sm">{ACTION_LABELS[e.action]}</TableCell>
              <TableCell className="text-sm">{e.target_email ?? "—"}</TableCell>
              <TableCell className="text-sm">
                {e.actor_email ?? <span className="text-muted-foreground">fora da aplicação</span>}
              </TableCell>
              <TableCell className="text-sm">
                {roleLabel(e.previous_role)} → {roleLabel(e.new_role)}
              </TableCell>
              <TableCell className="text-sm">{routeLabel(e)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
