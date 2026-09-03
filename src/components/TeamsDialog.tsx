import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { TEAM_COLORS, type Dev, type Team } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import { TeamColorSwatches, TeamSelectOption } from "@/components/TeamPickerControls";

const NEW_TEAM = "__new__";

export function TeamsDialog({
  open,
  project,
  onOpenChange,
}: {
  open: boolean;
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();

  // MESMA queryKey do BoardGrid e do DevDialog, de propósito: chaves
  // diferentes fariam os componentes brigarem pela mesma entrada de cache e
  // este diálogo listaria times do projeto errado (ver DevDialog.tsx:52-56).
  const teamsQ = useQuery({
    queryKey: ["board", "teams", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("jira_project", project)
        .order("position");
      if (error) throw error;
      return data as Team[];
    },
  });
  const teams = teamsQ.data ?? [];

  // MESMA queryKey de devs do BoardGrid, de propósito — e por isso o select,
  // os filtros, a ordenação e o cast precisam ser IDÊNTICOS aos de lá. O
  // TanStack Query v5 guarda uma única entrada por chave e usa a `queryFn`
  // do observer que renderizou por último; se este diálogo registrasse um
  // select mais estreito sob a mesma chave, um refetch em segundo plano
  // disparado com o diálogo aberto rodaria essa versão e sobrescreveria o
  // cache com linhas parciais, derrubando os campos que o grid e o DevDialog
  // dependem para renderizar, ordenar e montar payloads de mutação.
  const devsQ = useQuery({
    queryKey: ["board", "devs", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devs")
        .select("*")
        .eq("jira_project", project)
        .order("position")
        .order("name");
      if (error) throw error;
      return data as Dev[];
    },
  });
  const counts = useMemo(() => {
    const list = devsQ.data ?? [];
    const map = new Map<string, number>();
    for (const d of list) {
      map.set(d.team_id, (map.get(d.team_id) ?? 0) + 1);
    }
    return map;
  }, [devsQ.data]);

  const [editing, setEditing] = useState<string | null>(null); // team.id, ou "__new__"
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(TEAM_COLORS[0]!);

  // Guarda só o id, não o Team inteiro: `removing` é derivado de `teams` logo
  // abaixo, em vez de um segundo snapshot que poderia divergir da query (achado
  // de simplificação no code review do PR #33). Efeito colateral aceito: se o
  // time em confirmação for excluído por outra sessão enquanto o diálogo está
  // aberto, `removing` vira `null` no próximo refetch e a confirmação fecha
  // sozinha — não há mais time para confirmar, então isso é o comportamento
  // certo, não uma regressão.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removing = teams.find((t) => t.id === removingId) ?? null;
  const [moveTo, setMoveTo] = useState<string>("");

  // Limpa o formulário quando o diálogo fecha, não quando abre: diferente de
  // SprintDialog/DevDialog, não há um "item selecionado" vindo de fora para
  // reidratar — a lista inteira já vem da query, e o único estado local é o
  // formulário de criação/edição em si.
  useEffect(() => {
    if (open) return;
    setEditing(null);
    setDraftName("");
    setDraftColor(TEAM_COLORS[0]!);
  }, [open]);

  function startEdit(team: Team) {
    setEditing(team.id);
    setDraftName(team.name);
    setDraftColor(team.color);
  }

  // Pré-seleciona o destino no momento de abrir a confirmação, não via
  // efeito: `teams` já está disponível aqui, e recalcular a cada abertura
  // evita carregar um `moveTo` velho de uma exclusão anterior — inclusive de
  // uma exclusão anterior de um time COM pessoas, cancelada em seguida: como
  // `startRemove` roda sempre que a confirmação abre, não existe caminho para
  // um `moveTo` de uma chamada anterior sobreviver até a próxima.
  function startRemove(team: Team) {
    setRemovingId(team.id);
    // Time sem pessoas manda `_target` NULL, sempre: a RPC agora valida o
    // destino sempre que ele não é nulo, mesmo quando o time de origem está
    // vazio. Uma pré-seleção sobrando aqui faria uma exclusão sem nenhuma
    // pessoa envolvida falhar por causa de um destino que o usuário nunca
    // escolheu nem viu na tela (o caso "sem pessoas" não mostra Select).
    if ((counts.get(team.id) ?? 0) === 0) {
      setMoveTo("");
      return;
    }
    const others = teams.filter((t) => t.id !== team.id);
    const semTime = others.find((t) => t.name === "Sem time");
    setMoveTo(semTime?.id ?? others[0]?.id ?? "");
  }

  function startNew() {
    setEditing(NEW_TEAM);
    setDraftName("");
    setDraftColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]!);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: draftName.trim(), color: draftColor };
      // jira_project NÃO entra no payload de update: é o que impede mover um
      // time entre projetos. No insert ele é obrigatório (teams é raiz do
      // eixo e a coluna não tem DEFAULT).
      //
      // `position` também não entra no insert: o trigger `teams_set_position`
      // sempre recalcula o próximo valor a partir do que já está no banco.
      // `teams.length` do cache deste diálogo pode estar desatualizado entre
      // abas/sessões, e duas criações quase simultâneas lendo o mesmo
      // `teams.length` inseririam dois times na mesma position (achado do
      // code review do PR #33) — mandar o valor aqui seria ignorado mesmo,
      // e mantê-lo sugeriria (errado) que o cliente ainda controla a posição.
      const res =
        editing === NEW_TEAM
          ? await supabase.from("teams").insert({ ...payload, jira_project: project })
          : await supabase.from("teams").update(payload).eq("id", editing!);
      if (res.error) throw res.error;
    },
    onSuccess: async () => {
      // `await` de propósito: sem ele, `save.isPending` libera o botão
      // "Salvar" assim que o insert/update termina, antes do refetch
      // atualizar `teams` — mesma classe de corrida do `reorder` abaixo.
      await qc.invalidateQueries({ queryKey: ["board", "teams"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  // Setas em vez de drag-and-drop: a spec ("Superfície de UI") pede a forma
  // mais simples que resolve o problema, e a lista de times de um projeto é
  // curta o bastante para que reordenar par a par seja suficiente.
  const reorder = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: "up" | "down" }) => {
      const idx = teams.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const neighbourIdx = dir === "up" ? idx - 1 : idx + 1;
      const current = teams[idx];
      const neighbour = teams[neighbourIdx];
      if (!current || !neighbour) return;

      // Troca direta de position, em paralelo: os dois valores já foram
      // calculados acima, então uma escrita não depende do resultado da
      // outra. Não há `UNIQUE (jira_project, position)`, então também não
      // existe colisão a evitar com um passo intermediário.
      const [res1, res2] = await Promise.all([
        supabase.from("teams").update({ position: neighbour.position }).eq("id", current.id),
        supabase.from("teams").update({ position: current.position }).eq("id", neighbour.id),
      ]);
      if (res1.error) throw res1.error;
      if (res2.error) throw res2.error;
    },
    onSuccess: async () => {
      // `await` de propósito, não `invalidateQueries(...)` solto: sem isto,
      // `reorder.isPending` volta a `false` assim que as duas escritas
      // terminam, ANTES do refetch atualizar `teams` — e um clique rápido
      // em ↑/↓ logo em seguida leria posições já obsoletas do array local,
      // podendo deixar dois times com a mesma `position` (achado do code
      // review do PR #33). Aguardar aqui mantém os botões desabilitados até
      // `teams` estar de fato atualizado.
      await qc.invalidateQueries({ queryKey: ["board", "teams"] });
    },
    // Também invalida no erro, diferente de `save`: `save` é uma escrita
    // única, que ou aplica ou não aplica. Esta mutation faz duas chamadas
    // sequenciais e pode falhar entre elas — se a primeira `update` for bem
    // sucedida e a segunda falhar, o banco fica com a posição parcialmente
    // trocada enquanto a tela ainda mostra a ordem antiga. Sem invalidar
    // aqui, o usuário veria só o toast de erro e continuaria clicando a
    // partir de uma lista que não bate mais com o banco.
    onError: (e: Error) => {
      toast.error(boardErrorMessage(e));
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!removing) return;
      // RPC e não .delete(): mover as pessoas e apagar o time precisam estar na
      // mesma transação. Ver a spec, "Decisão central".
      const { error } = await supabase.rpc("delete_team", {
        _team: removing.id,
        _target: moveTo || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // As duas invalidações são obrigatórias: a RPC mexe em `devs.team_id`
      // (quem mudou de time) e em `devs.position` (renumeração dentro do time
      // de destino) — sem a segunda o grid mostraria posições velhas.
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
      qc.invalidateQueries({ queryKey: ["board", "devs"] });
      setRemovingId(null);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  // Deriva os três casos da tabela da spec a partir do time em confirmação:
  // contagem de pessoas e existência de outro time no projeto.
  const removingCount = removing ? (counts.get(removing.id) ?? 0) : 0;
  const otherTeams = removing ? teams.filter((t) => t.id !== removing.id) : [];
  // Frase completa (artigo + número + substantivo), não o "pessoa(s)" da
  // linha da lista: no diálogo de exclusão o texto é uma frase de verdade
  // ("Mover a 1 pessoa", "... e tem 1 pessoa"), e uma marca de plural entre
  // parênteses destoa de uma confirmação destrutiva. `n` sempre é > 0 nos
  // dois lugares que chamam isto — o caso "sem pessoas" tem sua própria
  // frase, sem contagem.
  const pessoasPhrase = (n: number) => (n === 1 ? "1 pessoa" : `${n} pessoas`);
  // `startRemove` garante que `moveTo` fica "" sempre que `otherTeams` está
  // vazio (não há Select pra preenchê-lo nesse caso), então checar
  // `otherTeams.length === 0` aqui seria redundante com `!moveTo` — a
  // simplificação abaixo depende desse invariante (achado do code review do
  // PR #33).
  const removeDisabled = remove.isPending || !removing || (removingCount > 0 && !moveTo);

  function renderForm(key: string) {
    return (
      <div key={key} className="space-y-3 rounded-lg border border-dashed border-grid-line p-3">
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Nome do time"
          autoFocus
        />
        <TeamColorSwatches value={draftColor} onChange={setDraftColor} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={!draftName.trim() || save.isPending}
          >
            Salvar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* O projeto aparece como texto, não como campo — mesmo racional do
              SprintDialog: não deve haver dúvida de onde os times pertencem. */}
          <DialogTitle>Times · {project}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {teams.length === 0 && editing !== NEW_TEAM ? (
            <p className="text-sm text-muted-foreground">
              Nenhum time cadastrado no {project} ainda.
            </p>
          ) : (
            teams.map((t, idx) =>
              editing === t.id ? (
                renderForm(t.id)
              ) : (
                <div key={t.id} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="flex-1 truncate text-sm">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {counts.get(t.id) ?? 0} pessoa(s)
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Mover ${t.name} para cima`}
                    disabled={idx === 0 || reorder.isPending}
                    onClick={() => reorder.mutate({ id: t.id, dir: "up" })}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Mover ${t.name} para baixo`}
                    disabled={idx === teams.length - 1 || reorder.isPending}
                    onClick={() => reorder.mutate({ id: t.id, dir: "down" })}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${t.name}`}
                    onClick={() => startEdit(t)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Excluir ${t.name}`}
                    onClick={() => startRemove(t)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ),
            )
          )}
          {editing === NEW_TEAM ? renderForm(NEW_TEAM) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {editing === null ? (
            <Button variant="outline" size="sm" onClick={startNew}>
              + Novo time
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirmação simples, não nominal (sem digitar o nome do time): ao
          contrário da exclusão de usuário em /admin, aqui nada é destruído
          além do time em si — as pessoas apenas mudam de time, e os cartões
          de alocação delas não são tocados. A assimetria com UserTable.tsx é
          proposital; não "conserte" trazendo a confirmação nominal para cá. */}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemovingId(null);
            setMoveTo("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir time?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {removing && removingCount === 0 ? (
                  <p>O time &quot;{removing.name}&quot; será excluído.</p>
                ) : null}

                {removing && removingCount > 0 && otherTeams.length > 0 ? (
                  <div className="space-y-1.5">
                    <p>
                      Mover {removingCount === 1 ? "a" : "as"} {pessoasPhrase(removingCount)} para:
                    </p>
                    <Select value={moveTo} onValueChange={setMoveTo}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um time" />
                      </SelectTrigger>
                      <SelectContent>
                        {otherTeams.map((t) => (
                          <TeamSelectOption key={t.id} team={t} />
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {removing && removingCount > 0 && otherTeams.length === 0 ? (
                  <p>
                    Este é o único time do {project} e tem {pessoasPhrase(removingCount)}. Crie
                    outro time antes de excluir esse.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeDisabled}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                // Sem isto o Radix fecha o diálogo no clique, e uma falha na
                // exclusão viraria um toast sem contexto nenhum na tela.
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
