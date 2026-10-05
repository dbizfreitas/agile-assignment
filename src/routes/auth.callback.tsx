import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { completeMicrosoftLogin } from "@/integrations/azure/sso.functions";
import { AZURE_RETURN_KEY, AZURE_STATE_KEY, azureRedirectUri } from "@/integrations/azure/config";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrando — Sprint Board" },
      { name: "description", content: "Concluindo o login com Microsoft." },
      { property: "og:title", content: "Entrando — Sprint Board" },
      { property: "og:description", content: "Concluindo o login com Microsoft." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallback,
});

function safePath(p: string | null) {
  return p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/auth/") ? p : "/";
}

function AuthCallback() {
  const navigate = useNavigate();
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      try {
        const q = new URLSearchParams(window.location.search);
        const err = q.get("error_description") ?? q.get("error");
        if (err) throw new Error(err);
        const code = q.get("code");
        const state = q.get("state");
        const stored = sessionStorage.getItem(AZURE_STATE_KEY);
        sessionStorage.removeItem(AZURE_STATE_KEY);
        if (!code || !state || state !== stored) throw new Error("Falha na validação de segurança. Tente novamente.");

        const { tokenHash } = await completeMicrosoftLogin({ data: { code, redirectUri: azureRedirectUri() } });
        const { error: otpError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
        if (otpError) throw otpError;

        const back = safePath(sessionStorage.getItem(AZURE_RETURN_KEY));
        sessionStorage.removeItem(AZURE_RETURN_KEY);
        window.history.replaceState(null, "", "/");
        await navigate({ to: back as "/", replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível entrar");
        setTimeout(() => navigate({ to: "/", replace: true }), 4000);
      }
    })();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">Voltando para o login...</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Concluindo login com Microsoft...</p>
        )}
      </div>
    </div>
  );
}
