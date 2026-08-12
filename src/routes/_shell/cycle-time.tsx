import { createFileRoute } from "@tanstack/react-router";
import { CycleTimeView } from "@/components/cycle-time/CycleTimeView";

export const Route = createFileRoute("/_shell/cycle-time")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cycle Time — Tempo por status no fluxo do Jira" },
      {
        name: "description",
        content:
          "Quanto tempo cada demanda passou em cada status do fluxo, calculado a partir do changelog do Jira.",
      },
    ],
  }),
  component: CycleTimePage,
});

function CycleTimePage() {
  return <CycleTimeView />;
}
