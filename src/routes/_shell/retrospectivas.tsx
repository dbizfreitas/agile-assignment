import { createFileRoute } from "@tanstack/react-router";
import { RouletteView } from "@/components/retrospectivas/RouletteView";

// A guia fica escondida da nav e do acesso direto por URL para quem não tem
// a rota `retrospectivas` — checagem central em `_shell.tsx`, que bloqueia o
// conteúdo de cada guia via `routes.has(activeTab.id)` (não um único
// `canView` uniforme para as quatro). Isso é proteção real no nível de UI,
// consistente com o resto do app.
//
// O que essa checagem NÃO cobre: os dados desta tela (`PARTICIPANTS`, em
// `src/lib/retrospectivas/participants.ts` — nomes e e-mails corporativos
// reais, hardcoded) vão no bundle JS do cliente para QUALQUER pessoa que
// carregue o app, tenha ou não a rota liberada; e o estado em
// `use-roulette.ts` mora em `localStorage`. Nenhum dos dois passa por RLS ou
// por qualquer migration — não há controle de acesso no servidor para este
// dado. Esse gap está rastreado separadamente na issue
// dbizfreitas/agile-assignment#24 ("Mover PARTICIPANTS (Retrospectivas) do
// bundle estático para o banco").
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
