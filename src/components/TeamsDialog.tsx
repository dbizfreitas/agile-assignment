import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { TEAM_COLORS, type Dev, type Team } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";

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
      const res =
        editing === NEW_TEAM
          ? await supabase
              .from("teams")
              .insert({ ...payload, position: teams.length, jira_project: project })
          : await supabase.from("teams").update(payload).eq("id", editing!);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
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

      // Troca direta de position, duas chamadas sequenciais: não há
      // `UNIQUE (jira_project, position)`, então não existe colisão a
      // evitar com um passo intermediário.
      const res1 = await supabase
        .from("teams")
        .update({ position: neighbour.position })
        .eq("id", current.id);
      if (res1.error) throw res1.error;

      const res2 = await supabase
        .from("teams")
        .update({ position: current.position })
        .eq("id", neighbour.id);
      if (res2.error) throw res2.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
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

  function renderForm(key: string) {
    return (
      <div key={key} className="space-y-3 rounded-lg border border-dashed border-grid-line p-3">
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Nome do time"
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDraftColor(c)}
              style={{ backgroundColor: c }}
              className={`size-7 rounded-full transition-transform ${
                draftColor === c ? "scale-110 ring-2 ring-ring ring-offset-2" : ""
              }`}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
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
    </Dialog>
  );
}
