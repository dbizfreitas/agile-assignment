import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteLink, listPlatformUsers } from "@/integrations/supabase/admin-fns";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/admin";
import { TABS, type AppRoute } from "@/components/shell/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NO_ROLE = "__sem_papel__";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function UserTable({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();

  const usersQ = useQuery({
    queryKey: ["platform-users"],
    queryFn: () => listPlatformUsers(),
  });

  const setRole = useMutation({
    mutationFn: async (vars: { userId: string; role: AppRole | null }) => {
      const { error } = await supabase.rpc("set_user_role", {
        _target: vars.userId,
        // `null` = revogar papel. A função aceita NULL no banco, mas os tipos
        // gerados declaram o argumento como não anulável.
        _role: vars.role as AppRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
      void qc.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  const setRoutes = useMutation({
    mutationFn: async (vars: { userId: string; routes: AppRoute[] }) => {
      const { error } = await supabase.rpc("set_user_routes", {
        _target: vars.userId,
        _routes: vars.routes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rotas atualizadas");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
      void qc.invalidateQueries({ queryKey: ["user-routes"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  // O link de convite do Supabase pode expirar antes do convite em si
  // (Email OTP Expiration, padrão 24 h). "magiclink" funciona para um
  // usuário que já existe — "invite" falharia.
  const newLink = useMutation({
    mutationFn: async (email: string): Promise<string> => {
      const result = await generateInviteLink({ data: { email, kind: "magiclink" } });
      return result.link;
    },
    onSuccess: async (link) => {
      await navigator.clipboard.writeText(link);
      toast.success("Novo link copiado");
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  if (usersQ.isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Carregando usuários...</p>
    );
  }

  if (usersQ.isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {adminErrorMessage(usersQ.error)}
      </p>
    );
  }

  const users = usersQ.data ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>E-mail</TableHead>
            <TableHead className="w-40">Papel</TableHead>
            <TableHead className="w-44">Rotas</TableHead>
            <TableHead className="w-32">Último acesso</TableHead>
            <TableHead className="w-32">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.email}
                {u.id === currentUserId ? (
                  <span className="ml-2 text-[10px] text-muted-foreground">(você)</span>
                ) : null}
              </TableCell>
              <TableCell>
                <Select
                  value={u.role ?? NO_ROLE}
                  disabled={setRole.isPending}
                  onValueChange={(value) =>
                    setRole.mutate({
                      userId: u.id,
                      role: value === NO_ROLE ? null : (value as AppRole),
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        <span className="flex flex-col">
                          <span>{ROLE_LABELS[r]}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {ROLE_DESCRIPTIONS[r]}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_ROLE}>
                      <span className="flex flex-col">
                        <span>Sem acesso</span>
                        <span className="text-[10px] text-muted-foreground">
                          Não enxerga a plataforma
                        </span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <ToggleGroup
                  type="multiple"
                  size="sm"
                  value={u.routes}
                  disabled={setRoutes.isPending || u.role === null}
                  onValueChange={(next) =>
                    setRoutes.mutate({ userId: u.id, routes: next as AppRoute[] })
                  }
                >
                  {TABS.map((tab) => (
                    <ToggleGroupItem
                      key={tab.id}
                      value={tab.id}
                      title={tab.label}
                      aria-label={tab.label}
                    >
                      <tab.icon className="size-4" />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(u.lastSignInAt)}
              </TableCell>
              <TableCell>
                {u.pendingInvite ? (
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                      Pendente
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Gerar e copiar um novo link de acesso"
                      disabled={newLink.isPending}
                      onClick={() => newLink.mutate(u.email)}
                    >
                      <Link2 className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Ativo</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
