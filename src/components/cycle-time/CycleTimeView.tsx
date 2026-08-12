import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJiraCycleTime } from "@/integrations/jira/server-fns";
import { CYCLE_TIME_CONFIG, buildColumns, mergeStatusVariants } from "@/lib/cycle-time/calc";
import type { CycleTimeIssue, CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";
import type { JiraProjectKey } from "@/lib/projects";
import { useShell } from "@/components/shell/shell-context";
import { CycleTimeTable } from "./CycleTimeTable";

/** Sub-visão ativa. Nomes do original (localStorage `ctView`). */
type CycleTimeSubView = "status" | "full";

const ls = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

const LS_VIEW = "cycleTimeView";

function prepare(
  resp: CycleTimeResponse | undefined,
  mode: CycleTimeMode,
): { issues: CycleTimeIssue[]; columns: string[] } {
  if (!resp) return { issues: [], columns: [] };
  const cfg = CYCLE_TIME_CONFIG[mode];
  const issues = mergeStatusVariants(resp.issues, resp.statuses, cfg.aliases);
  return { issues, columns: buildColumns(issues, resp.statuses, cfg) };
}

export function CycleTimeView() {
  const qc = useQueryClient();
  const { project } = useShell();
  const [subView, setSubView] = useState<CycleTimeSubView>(() =>
    ls(LS_VIEW) === "full" ? "full" : "status",
  );
  const [recalculando, setRecalculando] = useState(false);

  // Duas queries separadas, não uma parametrizada pela aba ativa: alternar
  // entre as sub-visões passa a ser instantâneo (cache do Query) e é o
  // comportamento do original, cujo onProjectChange dispara loadCycleTime() e
  // loadCycleTime2() juntos. O prefixo ["jira", ...] casa o das outras queries.
  //
  // Sem `enabled` e sem `project ?? ""`: a casca garante uma chave válida.
  const stdQ = useQuery({
    queryKey: ["jira", "cycle-time", project, "standard"],
    queryFn: () => getJiraCycleTime({ data: { project, mode: "standard" } }),
    // Casa com o cache de 5 min que `fetchCycleTime` já mantém no servidor:
    // um refetch antes disso devolveria exatamente o mesmo payload.
    staleTime: 5 * 60_000,
  });

  const fullQ = useQuery({
    queryKey: ["jira", "cycle-time", project, "full"],
    queryFn: () => getJiraCycleTime({ data: { project, mode: "full" } }),
    staleTime: 5 * 60_000,
  });

  const std = useMemo(() => prepare(stdQ.data, "standard"), [stdQ.data]);
  const full = useMemo(() => prepare(fullQ.data, "full"), [fullQ.data]);

  function handleSubViewChange(v: string) {
    const next: CycleTimeSubView = v === "full" ? "full" : "status";
    setSubView(next);
    save(LS_VIEW, next);
  }

  async function handleRecalcular() {
    setRecalculando(true);
    try {
      // `force` precisa chegar ao SERVIDOR: invalidateQueries sozinho só limpa
      // o cache do cliente, e o servidor devolveria o mesmo payload por até 5
      // min — o botão pareceria quebrado. Os dois modos recarregam juntos,
      // como no original.
      const [novoStd, novoFull] = await Promise.all([
        getJiraCycleTime({ data: { project, mode: "standard", force: true } }),
        getJiraCycleTime({ data: { project, mode: "full", force: true } }),
      ]);
      qc.setQueryData(["jira", "cycle-time", project, "standard"], novoStd);
      qc.setQueryData(["jira", "cycle-time", project, "full"], novoFull);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao recalcular o cycle time");
    } finally {
      setRecalculando(false);
    }
  }

  const carregando = stdQ.isFetching || fullQ.isFetching || recalculando;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <main className="flex-1 overflow-y-auto p-4">
        <Tabs value={subView} onValueChange={handleSubViewChange}>
          {/* Toolbar do painel: as sub-visões e o "Recalcular" na mesma linha.
              "Recalcular" NÃO virou um botão global de atualizar: ele precisa
              mandar `force` ao servidor e o "Atualizar dados" do Compromisso
              faz outra coisa por outro caminho (divergência 4 da spec). */}
          <div className="flex flex-wrap items-center gap-3">
            <TabsList>
              <TabsTrigger value="status">Em Andamento</TabsTrigger>
              <TabsTrigger value="full">Histórico Completo</TabsTrigger>
            </TabsList>

            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={handleRecalcular}
              disabled={carregando}
            >
              <RefreshCw className={`size-4 ${carregando ? "animate-spin" : ""}`} /> Recalcular
            </Button>
          </div>

          <TabsContent value="status">
            <CycleTimePane
              project={project}
              isLoading={stdQ.isLoading}
              error={stdQ.error}
              issues={std.issues}
              columns={std.columns}
              mode="standard"
              title="Cycle Time da esteira de produção"
              subtitle={null}
            />
          </TabsContent>

          <TabsContent value="full">
            <CycleTimePane
              project={project}
              isLoading={fullQ.isLoading}
              error={fullQ.error}
              issues={full.issues}
              columns={full.columns}
              mode="full"
              title="Histórico Completo"
              subtitle="todos os statuses do projeto"
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function CycleTimePane({
  project,
  isLoading,
  error,
  issues,
  columns,
  mode,
  title,
  subtitle,
}: {
  // Não anulável: a casca garante. O ramo "Selecione um projeto." que existia
  // aqui era defesa contra um estado que não existe mais.
  project: JiraProjectKey;
  isLoading: boolean;
  error: Error | null;
  issues: CycleTimeIssue[];
  columns: string[];
  mode: CycleTimeMode;
  title: string;
  subtitle: string | null;
}) {
  if (error) {
    // error.message já vem traduzido pelo handler de getJiraCycleTime.
    return <p className="py-20 text-center text-sm text-destructive">{error.message}</p>;
  }
  if (isLoading) {
    return (
      <p className="py-20 text-center text-sm text-muted-foreground">Calculando cycle time…</p>
    );
  }
  const cfg = CYCLE_TIME_CONFIG[mode];
  // key={project}: trocar de projeto descarta ordenação e página da tabela em
  // vez de carregá-las para dados de outro projeto.
  return (
    <CycleTimeTable
      key={project}
      title={title}
      subtitle={subtitle}
      issues={issues}
      columns={columns}
      fmt={cfg.fmt}
      pageSize={cfg.pageSize}
    />
  );
}
