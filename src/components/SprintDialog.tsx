import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { Sprint } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import { QUARTERS, isValidQuarter, sprintIssues } from "@/lib/sprint-validation";

function demandasPhrase(n: number) {
  return n === 1 ? "1 demanda" : `${n} demandas`;
}

// Só é chamado com fim >= início (o diálogo barra o caso invertido antes).
// O antigo Math.max(1, …) mascarava a inversão como "1 dias corridos".
function diffDays(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
}

// O Radix Select não aceita item com value "", então "sem quarter" usa um
// sentinela e é convertido para "" no estado.
const NO_QUARTER = "none";

export function SprintDialog({
  sprint,
  open,
  count,
  sprints,
  allocationCount,
  project,
  onOpenChange,
}: {
  sprint: Sprint | null;
  open: boolean;
  count: number;
  /** Sprints do projeto atual, para detectar código duplicado e sobreposição. */
  sprints: Sprint[];
  /** Nº de demandas da sprint: apagadas em cascata junto com ela. */
  allocationCount: number;
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [quarter, setQuarter] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Quarter gravado antes da issue #47 fora de Q1–Q4 (ex.: "Q9"): o Select
  // não consegue exibi-lo, então avisamos em vez de descartá-lo em silêncio.
  const [legacyQuarter, setLegacyQuarter] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    setCode(sprint?.code ?? "");
    const q = (sprint?.quarter ?? "").trim().toUpperCase();
    setQuarter(isValidQuarter(q) ? q : "");
    setLegacyQuarter(isValidQuarter(q) ? null : (sprint?.quarter ?? null));
    setStart(sprint?.start_date ?? "");
    setEnd(sprint?.end_date ?? "");
  }, [open, sprint]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        code: code.trim(),
        quarter,
        start_date: start,
        end_date: end,
        days: diffDays(start, end),
        position: sprint?.position ?? count,
        // sprints é raiz do eixo das linhas: cada projeto tem seu calendário e
        // o projeto vem da tela, sem campo no formulário e sem DEFAULT no
        // banco. Nenhum campo novo aparece — só o texto do título.
        jira_project: project,
      };
      const res = sprint
        ? await supabase.from("sprints").update(payload).eq("id", sprint.id)
        : await supabase.from("sprints").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "sprints"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!sprint) return;
      const { error } = await supabase.from("sprints").delete().eq("id", sprint.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "sprints"] });
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      setConfirming(false);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  const issues = sprintIssues({ id: sprint?.id ?? null, code, start, end }, sprints);
  // Sobreposição só avisa: não entra no canSave.
  const canSave = Boolean(code.trim() && start && end) && !issues.inverted && !issues.duplicate;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            {/* O projeto aparece como texto, não como campo: não deve haver
              dúvida de onde a sprint vai nascer. */}
            <DialogTitle>
              {sprint ? "Editar sprint" : "Nova sprint"} · {project}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="scode">Sprint</Label>
                <Input
                  id="scode"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="26.3.1"
                  autoFocus
                />
                {issues.duplicate ? (
                  <p className="text-xs text-destructive">
                    Já existe a sprint &quot;{issues.duplicate.code}&quot; neste projeto.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="squarter">Quarter</Label>
                <Select
                  value={quarter || NO_QUARTER}
                  onValueChange={(v) => {
                    setQuarter(v === NO_QUARTER ? "" : v);
                    setLegacyQuarter(null);
                  }}
                >
                  <SelectTrigger id="squarter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_QUARTER}>Sem quarter</SelectItem>
                    {QUARTERS.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {legacyQuarter ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    O quarter salvo (&quot;{legacyQuarter}&quot;) não é válido. Escolha Q1–Q4.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sstart">Início</Label>
                <Input
                  id="sstart"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send">Fim</Label>
                <Input id="send" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            {issues.inverted ? (
              <p className="text-xs text-destructive">
                A data de fim não pode ser anterior à de início.
              </p>
            ) : start && end ? (
              <p className="text-xs text-muted-foreground">
                Duração: {diffDays(start, end)} dias corridos
              </p>
            ) : null}
            {issues.overlaps.length > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                As datas se sobrepõem {issues.overlaps.length === 1 ? "à sprint" : "às sprints"}{" "}
                {issues.overlaps.map((s) => s.code).join(", ")}. Você ainda pode salvar.
              </p>
            ) : null}
          </div>

          <DialogFooter className="sm:justify-between">
            {sprint ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-4" /> Excluir
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
            <AlertDialogTitle>Excluir sprint?</AlertDialogTitle>
            <AlertDialogDescription>
              {allocationCount === 0 ? (
                <>A sprint &quot;{sprint?.code}&quot; será excluída.</>
              ) : (
                <>
                  A sprint &quot;{sprint?.code}&quot; será excluída junto com{" "}
                  <strong>{demandasPhrase(allocationCount)}</strong>{" "}
                  {allocationCount === 1 ? "alocada" : "alocadas"} nela. Essa ação não pode ser
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
              {remove.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
