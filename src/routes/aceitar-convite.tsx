import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { LayoutGrid } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/aceitar-convite")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Aceitar convite — Sprint Board" }, { name: "robots", content: "noindex" }],
  }),
  component: AcceptInvite,
});

function AcceptInvite() {
  const navigate = useNavigate();
  // O link do convite traz o token no fragmento da URL; o supabase-js
  // troca por sessão automaticamente (detectSessionInUrl).
  const { session, loading } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha definida. Bem-vindo!");
      await navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível definir a senha");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Validando convite...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-pop">
          <h1 className="text-lg font-semibold">Convite inválido ou expirado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Peça um novo link ao administrador da plataforma.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-pop">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Defina sua senha</h1>
            <p className="text-xs text-muted-foreground">{session.user.email}</p>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo de 8 caracteres"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Salvando..." : "Entrar na plataforma"}
          </Button>
        </form>
      </div>
    </div>
  );
}
