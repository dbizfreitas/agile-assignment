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
import { TEAM_COLORS, initialsFrom, type Dev, type Team } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";

const NEW_TEAM = "__new__";

export function DevDialog({
  dev,
  open,
  count,
  project,
  onOpenChange,
}: {
  dev: Dev | null;
  open: boolean;
  count: number;
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
    setName(dev?.name ?? "");
    setTeamId(dev?.team_id ?? (teams.length > 0 ? teams[0]!.id : NEW_TEAM));
    setNewTeamName("");
    setNewTeamColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]!);
    setAvailableFrom(dev?.available_from ?? "");
    setAvailableTo(dev?.available_to ?? "");
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
        position: dev?.position ?? count,
        // `|| null` e não a string vazia: `""` em coluna `date` é erro de
        // sintaxe no Postgres, e `null` é o valor que significa "sem
        // restrição" — o mesmo estado de toda pessoa cadastrada antes da
        // migration.
        available_from: availableFrom || null,
        available_to: availableTo || null,
      };
      const res = dev
        ? await supabase.from("devs").update(payload).eq("id", dev.id)
        : // `jira_project` é obrigatório no insert; o trigger devs_set_project
          // recalcula a partir do time, então mandar o projeto da tela é
          // apenas o valor correto de partida.
          await supabase.from("devs").insert({ ...payload, jira_project: project });
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "devs"] });
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  // Comparação de strings `YYYY-MM-DD`, mesma técnica de `isDevAvailableInSprint`.
  const windowInverted = Boolean(availableFrom && availableTo && availableTo < availableFrom);

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
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  return (
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
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      {t.name}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value={NEW_TEAM}>+ Criar novo time</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
                <div className="flex flex-wrap gap-2">
                  {TEAM_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTeamColor(c)}
                      style={{ backgroundColor: c }}
                      className={`size-7 rounded-full transition-transform ${
                        newTeamColor === c ? "scale-110 ring-2 ring-ring ring-offset-2" : ""
                      }`}
                      aria-label={`Cor ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Disponibilidade</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dfrom" className="text-xs font-normal text-muted-foreground">
                  A partir de
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
              onClick={() => remove.mutate()}
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
  );
}
