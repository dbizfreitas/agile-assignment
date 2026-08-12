import { createFileRoute } from "@tanstack/react-router";
import { CompromissoView } from "@/components/compromisso/CompromissoView";

export const Route = createFileRoute("/_shell/compromisso")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Compromisso — Acompanhamento de sprint no Jira" },
      {
        name: "description",
        content: "Status, burndown e demandas da sprint ativa, direto do Jira.",
      },
    ],
  }),
  component: CompromissoPage,
});

function CompromissoPage() {
  return <CompromissoView />;
}
