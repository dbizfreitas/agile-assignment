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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  STATUS_LIST,
  TIPO_LIST,
  type Allocation,
  type AllocationStatus,
  type AllocationTipo,
} from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";

export type AllocationDraft = {
  id?: string;
  sprint_id: string;
  dev_id: string;
  title?: string;
  ticket_key?: string | null;
  ticket_url?: string | null;
  status?: AllocationStatus;
  tipo?: AllocationTipo;
  notes?: string | null;
};

export function AllocationDialog({
  draft,
  project,
  onOpenChange,
}: {
  draft: AllocationDraft | null;
  /** Obrigatório no insert; o cartão nasce no projeto da tela. */
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [status, setStatus] = useState<AllocationStatus>("nao_especificada");
  const [tipo, setTipo] = useState<AllocationTipo>("planejado");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title ?? "");
    setTicketKey(draft.ticket_key ?? "");
    setTicketUrl(draft.ticket_url ?? "");
    setStatus(draft.status ?? "nao_especificada");
    setTipo(draft.tipo ?? "planejado");
    setNotes(draft.notes ?? "");
  }, [draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const payload = {
        sprint_id: draft.sprint_id,
        dev_id: draft.dev_id,
        title: title.trim(),
        ticket_key: ticketKey.trim() || null,
        ticket_url: ticketUrl.trim() || null,
        status,
        tipo,
        notes: notes.trim() || null,
      };
      const res = draft.id
        ? await supabase.from("allocations").update(payload).eq("id", draft.id)
        : await supabase.from("allocations").insert({ ...payload, jira_project: project });
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!draft?.id) return;
      const { error } = await supabase.from("allocations").delete().eq("id", draft.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!draft} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Editar demanda" : "Nova demanda"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Demanda</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Cadastro massivo de medidores"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as AllocationStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_LIST.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${s.dot}`} />
                        {s.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as AllocationTipo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_LIST.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${t.dot}`} />
                        {t.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tk">Ticket</Label>
              <Input
                id="tk"
                value={ticketKey}
                onChange={(e) => setTicketKey(e.target.value)}
                placeholder="PIM-7862"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tu">Link</Label>
              <Input
                id="tu"
                value={ticketUrl}
                onChange={(e) => setTicketUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nt">Observações</Label>
            <Textarea
              id="nt"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contexto, dependências, riscos..."
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {draft?.id ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => remove.mutate()}
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
            <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function toDraft(a: Allocation): AllocationDraft {
  return {
    id: a.id,
    sprint_id: a.sprint_id,
    dev_id: a.dev_id,
    title: a.title,
    ticket_key: a.ticket_key,
    ticket_url: a.ticket_url,
    status: a.status,
    tipo: a.tipo,
    notes: a.notes,
  };
}
