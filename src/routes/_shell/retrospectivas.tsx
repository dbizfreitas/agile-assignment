import { createFileRoute } from "@tanstack/react-router";
import { RouletteView } from "@/components/retrospectivas/RouletteView";

// A guia fica escondida da nav e do acesso direto por URL para quem não tem
// a rota `retrospectivas` — checagem central em `_shell.tsx`, que bloqueia o
// conteúdo de cada guia via `routes.has(activeTab.id)` (não um único
// `canView` uniforme para as quatro).
//
// Desde a issue #24, essa proteção também vale para o DADO, não só para a
// navegação: `retro_participants`/`retro_roulette_state`
// (supabase/migrations/20260902180000_retro_participants_foundation.sql)
// são protegidas por RLS exigindo has_route(uid, 'retrospectivas') — quem
// não tem a rota não lê nome/e-mail de ninguém via API do Supabase, mesmo
// com o bundle JS em mãos. Mutações do sorteio passam por RPCs
// SECURITY DEFINER que exigem papel editor/admin além da rota
// (private.can_edit_retrospectivas).
export const Route = createFileRoute("/_shell/retrospectivas")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Retrospectivas — Roleta de sorteio do time" },
      {
        name: "description",
        content: "Sorteia quem conduz a próxima retro, com estado que sobrevive ao refresh.",
      },
    ],
  }),
  component: RetrospectivasPage,
});

function RetrospectivasPage() {
  return <RouletteView />;
}
