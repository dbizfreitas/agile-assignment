// Server-only. Port de jira-live/server/routes/cycle-time.ts, menos o
// roteamento Hono. Mesma convenção de config.server.ts: só é seguro importar
// estaticamente a partir de outro "*.server.ts" — a partir de um arquivo
// isomórfico (rota, componente), só via import dinâmico dentro do handler.
import { jiraGet } from "./client.server";
import { getCache, setCache, withCacheCoalescing } from "./cache.server";
import { withConcurrencyGate } from "./concurrency-gate.server";
import { ALLOWED_PROJECTS, JIRA_BASE } from "./config.server";
import type { CycleTimeIssue, CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";

// ── Bases compartilhadas para os Sets de exclusão ────────────────────────────
// Acrescentar um status terminal: editar apenas DONE_REJECTED.
// Acrescentar um status pré-workflow: editar apenas PRE_WORKFLOW.

const DONE_REJECTED = [
  "concluído",
  "concluido",
  "done",
  "rejeitada",
  "rejeitado",
  "rejected",
  "cancelada",
  "cancelado",
];

const PRE_WORKFLOW = [
  "to do",
  "todo",
  "backlog",
  "ready to specify",
  "to research",
  "to discover",
  "in discover",
];

// Modo full: só terminais + cancelled (permissivo — exibe todo o fluxo).
const EXCLUDE_FULL = new Set([...DONE_REJECTED, "cancelled"]);

// Modo standard: terminais + pré-workflow + os intermediários que a esteira de
// produção não considera "em andamento".
const EXCLUDE_STANDARD = new Set([
  ...DONE_REJECTED,
  ...PRE_WORKFLOW,
  "tarefas pendentes",
  "tarefas_pendentes",
  "ready to dev",
  "em análise",
  "em analise",
]);

// Os literais de JQL NÃO são derivados dos Sets acima: o JQL precisa dos nomes
// com acento e capitalização originais, o Set precisa de minúsculas
// normalizadas. Derivar um do outro exigiria uma tabela de tradução que é
// justamente o que estes dois literais já são.
const JQL_EXCLUDE_STANDARD =
  '"Concluído","Concluido","Done","Rejeitada","Rejeitado","Rejected",' +
  '"Cancelada","Cancelado","Cancelled","Tarefas Pendentes","Tarefas_Pendentes",' +
  '"To Do","Todo","Backlog","Ready to Dev","Em Análise","Em Analise",' +
  '"Ready to Specify","To Research","To Discover","In Discover"';

const JQL_EXCLUDE_FULL =
  '"Concluído","Concluido","Done","Rejeitada","Rejeitado","Rejected",' +
  '"Cancelada","Cancelado","Cancelled"';

// Tipos crus, locais a este módulo — não vão para src/lib. Só os campos que
// `fields=` pede, todos opcionais: o guard por issue em buildCtPayload existe
// justamente porque o Jira às vezes omite algum deles.
interface CycleTimeIssueRaw {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    assignee?: { displayName?: string } | null;
    created?: string;
    fixVersions?: Array<{ name?: string }>;
  };
  changelog?: {
    histories: Array<{
      created: string;
      items: Array<{ field: string; fromString?: string; toString?: string }>;
    }>;
  };
}

interface JiraSearchPage {
  issues: CycleTimeIssueRaw[];
  nextPageToken?: string;
}

interface JiraProjectStatusesEntry {
  statuses?: Array<{ name?: string }>;
}

// Guarda contra loop infinito — mesma razão de MAX_PAGES em projects.server.ts
// e sprints.server.ts. O laço do original é `while (true)`; aqui ganha teto
// porque o modo full é o único caminho sem o corte de 200 itens.
const MAX_PAGES = 200;

async function fetchCycleTimeIssues(
  project: string,
  jqlExclude: string,
  fullLoad: boolean,
): Promise<CycleTimeIssueRaw[]> {
  // ORDER BY created ASC (não updated DESC): fora do modo full, o corte de 200
  // itens abaixo precisa sobrar justamente pros itens mais ANTIGOS ainda
  // abertos — que são os "mais parados" que esta tela existe pra destacar.
  // Ordenar por updated DESC faria o corte descartar exatamente esses.
  const jql = `project = "${project}" AND status NOT IN (${jqlExclude}) ORDER BY created ASC`;
  const out: CycleTimeIssueRaw[] = [];
  let nextToken: string | undefined;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const params: Record<string, string> = {
      jql,
      fields: "summary,status,issuetype,assignee,created,fixVersions",
      expand: "changelog",
      maxResults: "100",
    };
    if (nextToken) params["nextPageToken"] = nextToken;

    const page = await jiraGet<JiraSearchPage>("/rest/api/3/search/jql", params);
    out.push(...page.issues);
    nextToken = page.nextPageToken;

    // Só a AUSÊNCIA de nextPageToken encerra o laço de verdade — uma página
    // menor que maxResults ainda pode vir seguida de mais páginas sob carga
    // (mesma causa documentada em issues.server.ts/computePageStarts).
    if (!nextToken) break;
    if (!fullLoad && out.length >= 200) break;
    if (pageNum === MAX_PAGES - 1) {
      console.error(
        `[jira/cycle-time] fetchCycleTimeIssues("${project}") atingiu o limite de ${MAX_PAGES} páginas — resultado pode estar incompleto.`,
      );
    }
  }
  return out;
}

// Alimenta a ordem das colunas. `project` já passou pela validação contra
// ALLOWED_PROJECTS em fetchCycleTime antes de chegar aqui — é o que torna
// seguro interpolá-lo no caminho (jiraGet ainda barra ".." e caminhos fora
// de /rest/).
async function fetchProjectStatuses(
  project: string,
  excludeStatuses: Set<string>,
): Promise<string[]> {
  try {
    const data = await jiraGet<JiraProjectStatusesEntry[]>(
      `/rest/api/3/project/${project}/statuses`,
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const itype of data) {
      for (const st of itype.statuses ?? []) {
        const name = (st.name ?? "").trim();
        if (name && !excludeStatuses.has(name.toLowerCase()) && !seen.has(name)) {
          seen.add(name);
          result.push(name);
        }
      }
    }
    return result;
  } catch (err) {
    // Falha aqui não derruba a resposta: sem a lista de status do projeto, a
    // ordem das colunas degrada para "ordem de aparição nas issues", que é o
    // fallback que buildStatusOrder já faz. Silenciosa para o cliente; o log
    // fica no servidor (o original engolia sem registrar nada).
    console.error(`[jira/cycle-time] Falha ao listar status de "${project}":`, err);
    return [];
  }
}

// Exportada para ser exercitada por script avulso — o cálculo é puro dado o
// `now` interno, e é o coração do port.
export function buildCtPayload(
  issues: CycleTimeIssueRaw[],
  projectStatuses: string[],
  excludeStatuses: Set<string>,
): CycleTimeResponse {
  // `now` capturado UMA vez por payload, não por issue: senão duas issues no
  // mesmo estado sairiam com totais ligeiramente diferentes só pela ordem em
  // que foram processadas.
  const now = new Date();

  // Acesso defensivo: uma issue com status ausente/malformado não pode
  // derrubar o filtro inteiro — trata como "sem status conhecido" e fica de
  // fora dos candidatos (o guard completo por issue está no flatMap abaixo).
  const candidates = issues.filter((i) => {
    const name = i.fields?.status?.name;
    return name != null && !excludeStatuses.has(name.toLowerCase().trim());
  });
  if (!candidates.length) return { statuses: projectStatuses, issues: [] };

  const output: CycleTimeIssue[] = candidates.flatMap((iss) => {
    try {
      const f = iss.fields;
      const createdDt = f.created ? new Date(f.created) : now;

      // Ordena por INSTANTE (Date), não pela string ISO crua: o changelog do
      // Jira nem sempre traz o mesmo número de casas decimais/offset, e a
      // comparação lexicográfica inverte a ordem real nesses casos.
      const histories = [...(iss.changelog?.histories ?? [])].sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
      );
      const transitions: Array<{ from: string; to: string; at: Date }> = [];
      for (const h of histories) {
        for (const item of h.items) {
          if (item.field === "status") {
            transitions.push({
              from: item.fromString ?? "",
              to: item.toString ?? "",
              at: new Date(h.created),
            });
          }
        }
      }

      // Acumula em SEGUNDOS crus e converte/arredonda pra dias uma única vez
      // no fim — arredondar a cada transição somava erro em issues com idas e
      // vindas ao mesmo status (horas de distorção no total).
      const statusSeconds: Record<string, number> = {};
      const addTime = (status: string, seconds: number) => {
        if (seconds > 0) statusSeconds[status] = (statusSeconds[status] ?? 0) + seconds;
      };

      const first = transitions[0];
      const last = transitions[transitions.length - 1];
      if (first && last) {
        addTime(first.from, (first.at.getTime() - createdDt.getTime()) / 1000);
        for (let i = 0; i < transitions.length - 1; i++) {
          const cur = transitions[i];
          const next = transitions[i + 1];
          if (!cur || !next) continue;
          addTime(cur.to, (next.at.getTime() - cur.at.getTime()) / 1000);
        }
        addTime(last.to, (now.getTime() - last.at.getTime()) / 1000);
      } else {
        // Issue sem nenhuma transição de status: todo o tempo desde `created`
        // fica no status atual.
        const currentStatus = f.status?.name ?? "";
        if (currentStatus) {
          addTime(currentStatus, (now.getTime() - createdDt.getTime()) / 1000);
        }
      }

      const filteredDays: Record<string, number> = Object.fromEntries(
        Object.entries(statusSeconds)
          .filter(([st]) => !excludeStatuses.has(st.toLowerCase().trim()))
          .map(([st, seconds]): [string, number] => [st, Math.round((seconds / 86400) * 10) / 10]),
      );

      const versionNames = (f.fixVersions ?? []).map((v) => v.name ?? "").filter(Boolean);
      const fixVersions = versionNames.length > 0 ? versionNames.join(", ") : "—";

      return [
        {
          key: iss.key,
          url: `${JIRA_BASE}/browse/${iss.key}`,
          summary: f.summary ?? "",
          type: f.issuetype?.name ?? "—",
          assignee: f.assignee?.displayName ?? "—",
          current_status: f.status?.name ?? "—",
          fix_versions: fixVersions,
          status_days: filteredDays,
          total_days: Math.round(Object.values(filteredDays).reduce((s, v) => s + v, 0) * 10) / 10,
        },
      ];
    } catch (err) {
      // Um campo inesperado numa única issue não pode derrubar a resposta
      // inteira — pula só essa issue (mesma postura de fetchIssuesForSprint).
      console.error(`[jira/cycle-time] Falha ao processar ${iss.key}, issue ignorada:`, err);
      return [];
    }
  });

  output.sort((a, b) => b.total_days - a.total_days);
  return { statuses: projectStatuses, issues: output };
}

// Limitação herdada, registrada e não corrigida aqui: o Jira devolve inline
// apenas as entradas mais recentes do changelog. Numa issue com histórico
// muito longo, os primeiros status podem não aparecer. O original tem
// exatamente o mesmo comportamento.

export async function fetchCycleTime(
  project: string,
  mode: CycleTimeMode,
  force: boolean,
): Promise<CycleTimeResponse> {
  // NÃO é redundante com o <Select> do cliente: `project` entra por
  // interpolação de string no JQL. Sem esta checagem, um cliente forjado
  // injeta JQL arbitrário e lê projetos fora da lista permitida. É controle de
  // segurança, não conveniência. Mesma mensagem de fetchSprintsForProject —
  // uma string, um significado.
  //
  // Normalizado UMA vez e reusado daqui pra baixo (JQL, path da API, chave de
  // cache) — sem isso "PIM" e "pim" validam igual mas geram entradas de cache
  // e chamadas ao Jira diferentes, fragmentando a coalescência.
  const key = project.toUpperCase();
  if (!ALLOWED_PROJECTS.has(key)) {
    throw new Error("projeto inválido ou não permitido");
  }

  const full = mode === "full";
  const excludeStatuses = full ? EXCLUDE_FULL : EXCLUDE_STANDARD;
  const jqlExclude = full ? JQL_EXCLUDE_FULL : JQL_EXCLUDE_STANDARD;
  const cacheKey = full ? `ct:full:${key}` : `ct:std:${key}`;

  if (!force) {
    const cached = getCache<CycleTimeResponse>(cacheKey);
    if (cached) return cached;
  }

  // "Recalcular" (force) pula a LEITURA do cache, mas continua DENTRO da
  // coalescência: dois cliques simultâneos não viram dois fan-outs.
  return withCacheCoalescing(cacheKey, async () => {
    // withConcurrencyGate envolve o par inteiro, igual ao original: o limite
    // global também vale entre chaves diferentes.
    const [projectStatuses, rawIssues] = await withConcurrencyGate(() =>
      Promise.all([
        fetchProjectStatuses(key, excludeStatuses),
        fetchCycleTimeIssues(key, jqlExclude, full),
      ]),
    );
    const built = buildCtPayload(rawIssues, projectStatuses, excludeStatuses);
    setCache(cacheKey, built);
    return built;
  });
}
