import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteLink } from "@/integrations/supabase/admin-fns";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/admin";
import { TABS, type AppRoute } from "@/components/shell/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DEFAULT_ROUTES: AppRoute[] = ["alocacoes"];

export function InviteDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("editor");
  const [routes, setRoutes] = useState<AppRoute[]>(DEFAULT_ROUTES);
  const [link, setLink] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async (): Promise<string> => {
      // 1. Registra o convite (o ator vem de auth.uid() dentro da RPC).
      const { error } = await supabase.rpc("create_invitation", {
        _email: email,
        _role: role,
        _routes: routes,
      });
      if (error) throw error;

      // 2. Cria o usuário e devolve o link. Não depende de SMTP.
      try {
        const result = await generateInviteLink({
          data: { email, kind: "invite" },
        });
        return result.link;
      } catch (linkError) {
        // Sem o link, o convite ficaria pendente e bloquearia este e-mail
        // por até 7 dias sem retry — desfaz para permitir tentar de novo.
        // Uma falha no rollback não pode mascarar o erro original.
        try {
          const { error: cancelError } = await supabase.rpc("cancel_invitation", {
            _email: email,
          });
          if (cancelError) {
            console.error("[admin] rollback do convite falhou:", cancelError);
          }
        } catch (cancelException) {
          console.error("[admin] rollback do convite falhou:", cancelException);
        }
        throw linkError;
      }
    },
    onSuccess: (value) => {
      setLink(value);
      toast.success("Convite criado. Copie o link e envie para a pessoa.");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  function reset() {
    setEmail("");
    setRole("editor");
    setRoutes(DEFAULT_ROUTES);
    setLink(null);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>
            O convite gera um link válido por 7 dias. Copie e envie pelo Teams.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3">
            <Label htmlFor="invite-link">Link de convite</Label>
            <div className="flex gap-2">
              <Input id="invite-link" readOnly value={link} className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copy}>
                <Copy className="size-4" />
              </Button>
            </div>
            <Button type="button" variant="ghost" className="w-full" onClick={reset}>
              Convidar outra pessoa
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@way2.com.br"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger id="invite-role">
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
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rotas liberadas</Label>
              <ToggleGroup
                type="multiple"
                value={routes}
                onValueChange={(next) => setRoutes(next as AppRoute[])}
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
            </div>
            <Button type="submit" className="w-full" disabled={invite.isPending}>
              {invite.isPending ? "Gerando convite..." : "Gerar link de convite"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
