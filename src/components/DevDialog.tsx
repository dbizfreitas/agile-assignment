import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  TEAM_COLORS,
  initialsFrom,
  moveInTeam,
  renumberChanges,
  teamMembers,
  type Dev,
  type Team,
} from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import { useReorderDevs } from "@/hooks/use-reorder-devs";
import { TeamColorSwatches, TeamSelectOption } from "@/components/TeamPickerControls";

const NEW_TEAM = "__new__";

function demandasPhrase(n: number) {
  return n === 1 ? "1 demanda" : `${n} demandas`;
}

export function DevDialog({
  dev,
  open,
  count,
  allocationCount,
  devs,
  project,
  onOpenChange,
}: {
  dev: Dev | null;
  open: boolean;
  count: number;
  /** Nº de demandas da pessoa: apagadas em cascata junto com ela. */
  allocationCount: number;
  /** Todas as pessoas do projeto (cache do quadro): base da ordem no time (#83). */
  devs: Dev[];
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<string>(NEW_TEAM);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState(TEAM_COLORS[0]!);
  // Strings vazias, não `null`: `<Input type="date">` é controlado e `null`
  // faria o React alternar entre controlado e não-controlado.
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableTo, setAvailableTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Índice (0-based) escolhido no Select "Posição no time" (#83).
  const [orderIndex, setOrderIndex] = useState(0);
  const reorderDevs = useReorderDevs(project);

  // MESMA queryKey do BoardGrid, de propósito: chaves diferentes fariam os dois
  // componentes brigarem pela mesma entrada de cache e o diálogo listaria times
  // do projeto errado. Como só existem times do projeto atual na lista, mover
  // uma pessoa para um time de outro projeto é impossível pela tela — e a FK
  // composta cobre o resto.
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

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    setName(dev?.name ?? "");
    setTeamId(dev?.team_id ?? (teams.length > 0 ? teams[0]!.id : NEW_TEAM));
    setNewTeamName("");
    setNewTeamColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]!);
    setAvailableFrom(dev?.available_from ?? "");
    setAvailableTo(dev?.available_to ?? "");
    setOrderIndex(
      dev
        ? Math.max(
            0,
            teamMembers(devs, dev.team_id).findIndex((m) => m.id === dev.id),
          )
        : 0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dev]);

  const save = useMutation({
    mutationFn: async () => {
      let finalTeamId = teamId;
      if (teamId === NEW_TEAM) {
        const teamRes = await supabase
          .from("teams")
          .insert({
            name: newTeamName.trim(),
            color: newTeamColor,
            position: teams.length,
            // teams é raiz do eixo das colunas: o projeto é explícito, vem da
            // tela e não tem DEFAULT no banco.
            jira_project: project,
          })
          .select("id")
          .single();
        if (teamRes.error) throw teamRes.error;
        finalTeamId = teamRes.data.id;
      }

      // Sem jira_project no payload de devs: o trigger devs_set_project o
      // deriva do time, e sobrescreveria o que fosse enviado.
      const payload = {
        name: name.trim(),
        initials: initialsFrom(name),
        team_id: finalTeamId,
        // `|| null` e não a string vazia: `""` em coluna `date` é erro de
        // sintaxe no Postgres, e `null` é o valor que significa "sem
        // restrição" — o mesmo estado de toda pessoa cadastrada antes da
        // migration.
        available_from: availableFrom || null,
        available_to: availableTo || null,
      };
      // `position` só vai no insert (#83): reenviá-la no UPDATE gravaria o
      // snapshot do momento em que o diálogo abriu e desfaria uma reordenação
      // feita por arraste enquanto ele estava aberto.
      const res = dev
        ? await supabase.from("devs").update(payload).eq("id", dev.id)
        : // `jira_project` é obrigatório no insert; o trigger devs_set_project
          // recalcula a partir do time, então mandar o projeto da tela é
          // apenas o valor correto de partida.
          await supabase
            .from("devs")
            .insert({ ...payload, position: count, jira_project: project });
      if (res.error) throw res.error;

      // Reordenação pelo diálogo (#83): só quando o time não mudou e o índice
      // escolhido difere do atual. Erro vira toast no hook; relança para o
      // onSuccess não fechar o diálogo.
      if (dev && finalTeamId === dev.team_id) {
        const members = teamMembers(devs, dev.team_id);
        const current = members.findIndex((m) => m.id === dev.id);
        if (current !== -1 && orderIndex !== current) {
          const changes = renumberChanges(moveInTeam(members, dev.id, orderIndex));
          if (changes.length > 0) {
            try {
              await reorderDevs.mutateAsync({ changes });
            } catch (e) {
              // O hook já mostrou o toast; marca o erro para o onError do
              // save não duplicá-lo e o diálogo permanecer aberto.
              throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
                alreadyReported: true,
              });
            }
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "devs"] });
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if ((e as Error & { alreadyReported?: boolean }).alreadyReported) return;
      toast.error(boardErrorMessage(e));
    },
  });

  // Comparação de strings `YYYY-MM-DD`, mesma técnica de `isDevAvailableInSprint`.
  const windowInverted = Boolean(availableFrom && availableTo && availableTo < availableFrom);

  // Índice atual da pessoa no time, para rotular as opções do Select (#83).
  const originalIndex = dev ? teamMembers(devs, dev.team_id).findIndex((m) => m.id === dev.id) : -1;

  const canSave =
    name.trim().length > 0 &&
    (teamId !== NEW_TEAM || newTeamName.trim().length > 0) &&
    !windowInverted;

  const remove = useMutation({
    mutationFn: async () => {
      if (!dev) return;
      const { error } = await supabase.from("devs").delete().eq("id", dev.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "devs"] });
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      setConfirming(false);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dev ? "Editar pessoa" : "Nova pessoa"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dname">Nome</Label>
              <Input
                id="dname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Daniel A."
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dteam">Time</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="dteam">
                  <SelectValue placeholder="Selecione um time" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <TeamSelectOption key={t.id} team={t} />
                  ))}
                  <SelectItem value={NEW_TEAM}>+ Criar novo time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dev && teamId === dev.team_id ? (
              <div className="space-y-1.5">
                <Label htmlFor="dorder">Posição no time</Label>
                <Select value={String(orderIndex)} onValueChange={(v) => setOrderIndex(Number(v))}>
                  <SelectTrigger id="dorder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers(devs, dev.team_id).map((m, i) => (
                      <SelectItem key={m.id} value={String(i)}>
                        {`${i + 1}º`}
                        {i !== originalIndex ? ` · lugar de ${m.name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Alternativa por teclado a arrastar a coluna no quadro.
                </p>
              </div>
            ) : dev ? (
              <p className="text-xs text-muted-foreground">
                A posição no novo time pode ser ajustada arrastando a coluna.
              </p>
            ) : null}

            {teamId === NEW_TEAM ? (
              <div className="space-y-4 rounded-lg border border-dashed border-grid-line p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tname">Nome do time</Label>
                  <Input
                    id="tname"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="Ex.: PIM"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cor do time</Label>
                  <TeamColorSwatches value={newTeamColor} onChange={setNewTeamColor} />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Disponibilidade</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dfrom" className="text-xs font-normal text-muted-foreground">
                    A partir de (opcional)
                  </Label>
                  <Input
                    id="dfrom"
                    type="date"
                    value={availableFrom}
                    onChange={(e) => setAvailableFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dto" className="text-xs font-normal text-muted-foreground">
                    Até (opcional)
                  </Label>
                  <Input
                    id="dto"
                    type="date"
                    value={availableTo}
                    onChange={(e) => setAvailableTo(e.target.value)}
                  />
                </div>
              </div>
              {windowInverted ? (
                <p className="text-xs text-destructive">
                  A data de fim não pode ser anterior à de início.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Em branco, a pessoa fica disponível em todas as sprints. A sprint precisa caber
                  inteira na janela para ficar habilitada.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            {dev ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-4" /> Remover
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover pessoa?</AlertDialogTitle>
            <AlertDialogDescription>
              {allocationCount === 0 ? (
                <>&quot;{dev?.name}&quot; será removida do quadro.</>
              ) : (
                <>
                  &quot;{dev?.name}&quot; será removida do quadro junto com{" "}
                  <strong>{demandasPhrase(allocationCount)}</strong>{" "}
                  {allocationCount === 1 ? "atribuída" : "atribuídas"} a ela. Essa ação não pode ser
                  desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                // Sem isto o Radix fecha o diálogo no clique, e uma falha na
                // exclusão viraria um toast sem contexto nenhum na tela.
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
