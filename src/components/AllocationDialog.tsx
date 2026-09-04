import { useEffect, useRef, useState } from "react";
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
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  STATUS_LIST,
  TIPO_LIST,
  type Allocation,
  type AllocationStatus,
  type AllocationTicket,
  type AllocationTipo,
} from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { extractJiraKey, jiraUrlFor, parseTicketTokens } from "@/lib/tickets";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type AllocationDraft = {
  id?: string;
  sprint_id: string;
  dev_id: string;
  title?: string;
  tickets?: AllocationTicket[];
  status?: AllocationStatus;
  tipo?: AllocationTipo;
  notes?: string | null;
};

export function AllocationDialog({
  draft,
  project,
  onOpenChange,
  onReplicate,
  replicateBlockReason,
  isReplicating,
}: {
  draft: AllocationDraft | null;
  /** Obrigatório no insert; o cartão nasce no projeto da tela. */
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
  /** Ausente (undefined) quando `draft` é um card novo, ainda sem `id`. */
  onReplicate?: (() => void) | undefined;
  /** Motivo do bloqueio vindo do BoardGrid (sem sprint seguinte, ou pessoa
   *  fora da janela de disponibilidade no destino). `null` quando pode
   *  replicar; `undefined` quando não se aplica (card novo). */
  replicateBlockReason?: string | null | undefined;
  isReplicating?: boolean | undefined;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [tickets, setTickets] = useState<AllocationTicket[]>([]);
  const [status, setStatus] = useState<AllocationStatus>("nao_especificada");
  const [tipo, setTipo] = useState<AllocationTipo>("planejado");
  const [notes, setNotes] = useState("");
  const ticketsListRef = useRef<HTMLDivElement>(null);
  const prevTicketsCount = useRef(0);

  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title ?? "");
    setTickets(draft.tickets ?? []);
    setStatus(draft.status ?? "nao_especificada");
    setTipo(draft.tipo ?? "planejado");
    setNotes(draft.notes ?? "");
    // Evita que o carregamento inicial dos tickets do draft seja lido como
    // "linha adicionada" pelo efeito de auto-scroll abaixo (abrir uma demanda
    // com vários tickets já deve mostrar do topo, não pular pro último).
    prevTicketsCount.current = (draft.tickets ?? []).length;
  }, [draft]);

  // Rola para o final da lista sempre que uma linha é ADICIONADA (digitar +
  // Ticket, ou colar vários de uma vez) — a mais recente fica sempre visível,
  // sem precisar rolar manualmente. Remoção/edição não mexe no scroll.
  useEffect(() => {
    if (tickets.length > prevTicketsCount.current && ticketsListRef.current) {
      ticketsListRef.current.scrollTop = ticketsListRef.current.scrollHeight;
    }
    prevTicketsCount.current = tickets.length;
  }, [tickets.length]);

  const addTicketRow = () => setTickets((prev) => [...prev, { key: "", url: null }]);
  const removeTicketRow = (index: number) =>
    setTickets((prev) => prev.filter((_, i) => i !== index));

  // Um campo só é auto-derivado do outro enquanto o valor atual "bater" com o
  // que a derivação produziria a partir do valor anterior — assim que o
  // usuário sobrescreve manualmente um dos dois com algo que não casa, a
  // derivação automática para de mexer naquele campo (evita sobrescrever
  // edição manual, mas continua recalculando enquanto for só o auto-preenchido
  // de antes — corrige o link "congelar" na 1ª tecla digitada na chave).
  const handleTicketKeyChange = (index: number, value: string) =>
    setTickets((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        const wasAutoDerived = !t.url || t.url === jiraUrlFor(t.key.trim().toUpperCase());
        const url = wasAutoDerived && value.trim() ? jiraUrlFor(value.trim().toUpperCase()) : t.url;
        return { key: value, url };
      }),
    );

  const handleTicketUrlChange = (index: number, value: string) =>
    setTickets((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        const oldDerivedKey = t.url ? extractJiraKey(t.url) : null;
        const wasAutoDerived = !t.key.trim() || t.key === oldDerivedKey;
        const key = wasAutoDerived ? (extractJiraKey(value) ?? t.key) : t.key;
        return { key, url: value };
      }),
    );

  /** Cola vários links/chaves Jira de uma vez (um por linha, espaço ou vírgula) e expande em linhas. */
  const handleTicketPaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const parsed = parseTicketTokens(text);
    if (parsed.length <= 1) {
      const [token] = parsed;
      if (token && !token.key && token.url) {
        toast.warning("Link colado não tem uma chave Jira reconhecida — preencha a chave manualmente.");
      }
      return;
    }
    e.preventDefault();
    const missingKeys = parsed.filter((t) => !t.key).length;
    if (missingKeys > 0) {
      toast.warning(
        `${missingKeys} link(s) colado(s) sem chave Jira reconhecida — preencha manualmente.`,
      );
    }
    setTickets((prev) => {
      const next = [...prev];
      next.splice(index, 1, ...parsed);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const payload = {
        sprint_id: draft.sprint_id,
        dev_id: draft.dev_id,
        title: title.trim(),
        tickets: tickets
          .filter((t) => t.key.trim() || t.url?.trim())
          .map((t) => ({ key: t.key.trim().toUpperCase(), url: t.url?.trim() || null })),
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

  // Formulário "sujo" = estado local diverge do draft do banco, usando a
  // MESMA normalização do payload de `save` (trim, uppercase na key, url
  // vazia -> null) — sem isso, espaço digitado e apagado marcaria sujo à toa.
  const normalizedTickets = (list: AllocationTicket[]) =>
    list
      .filter((t) => t.key.trim() || t.url?.trim())
      .map((t) => ({ key: t.key.trim().toUpperCase(), url: t.url?.trim() || null }));

  const isDirty = (() => {
    if (!draft) return false;
    if (title.trim() !== (draft.title ?? "").trim()) return true;
    if (status !== (draft.status ?? "nao_especificada")) return true;
    if (tipo !== (draft.tipo ?? "planejado")) return true;
    if ((notes.trim() || null) !== (draft.notes ?? null)) return true;
    const a = normalizedTickets(tickets);
    const b = normalizedTickets(draft.tickets ?? []);
    if (a.length !== b.length) return true;
    return a.some((t, i) => t.key !== b[i]!.key || t.url !== b[i]!.url);
  })();

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

          <div className="space-y-1.5">
            <Label>Tickets</Label>
            <div className="space-y-2">
              {/* max-h-32 ≈ 3 linhas (h-9 cada + gap-2) — a 4ª em diante rola só
                  aqui dentro, sem esticar o diálogo inteiro. Auto-rola para o
                  fim ao adicionar linha, para a mais nova ficar sempre visível. */}
              <div ref={ticketsListRef} className="max-h-32 space-y-2 overflow-y-auto pr-1">
                {tickets.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="grid flex-1 grid-cols-2 gap-2">
                      <Input
                        value={t.key}
                        onChange={(e) => handleTicketKeyChange(i, e.target.value)}
                        onPaste={(e) => handleTicketPaste(i, e)}
                        placeholder="PIM-7862"
                        aria-label="Chave do ticket"
                      />
                      <Input
                        value={t.url ?? ""}
                        onChange={(e) => handleTicketUrlChange(i, e.target.value)}
                        onPaste={(e) => handleTicketPaste(i, e)}
                        placeholder="https://..."
                        aria-label="Link do ticket"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeTicketRow(i)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addTicketRow}>
                <Plus className="size-3.5" /> Ticket
              </Button>
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
          <div className="flex items-center gap-2">
            {draft?.id && onReplicate ? (
              // Salvar fecha o diálogo (`save.onSuccess` chama `onOpenChange(false)`,
              // pré-existente) — então "editar, salvar, replicar" exige reabrir o
              // card depois de salvar; não há "salvar e o botão liberar no mesmo
              // diálogo". Atrito aceito: a issue já descarta "salvar e replicar
              // num gesto" de propósito.
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* aria-disabled (não `disabled`): um botão `disabled` sai da
                      árvore de foco e não recebe hover/tab, então o motivo do
                      bloqueio — que a issue exige "visível" — ficaria
                      inalcançável por teclado. Com aria-disabled o botão
                      continua focável e tooltip-able; o clique é barrado no
                      próprio handler. */}
                  <Button
                    variant="outline"
                    className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                    aria-disabled={isDirty || !!replicateBlockReason || isReplicating}
                    onClick={() => {
                      if (isDirty || replicateBlockReason || isReplicating) return;
                      onReplicate();
                    }}
                  >
                    <Copy className="size-4" /> Replicar na próxima sprint
                  </Button>
                </TooltipTrigger>
                {isDirty || replicateBlockReason ? (
                  <TooltipContent>
                    {isDirty ? "Salve as alterações antes de replicar." : replicateBlockReason}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            ) : null}
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
    tickets: a.tickets,
    status: a.status,
    tipo: a.tipo,
    notes: a.notes,
  };
}
