import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  clampWeeksToSprint,
  hasSpecStatus,
  sprintWeeks,
  weekLabel,
  type Allocation,
  type AllocationStatus,
  type AllocationTicket,
  type AllocationTipo,
  type Sprint,
} from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import {
  extractJiraKey,
  firstTicketUrl,
  isPartialHttpScheme,
  jiraUrlFor,
  normalizeJiraKey,
  parseTicketTokens,
  ticketKeyMismatch,
  ticketKeyProblem,
  ticketProjectMismatch,
  ticketUrlProblem,
} from "@/lib/tickets";
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
  week_start?: number | null;
  week_end?: number | null;
};

// O Radix Select não aceita `value=""`, então "Sem semana" usa um sentinela.
const NO_WEEK = "none";

export function AllocationDialog({
  draft,
  sprint,
  project,
  onOpenChange,
  onReplicate,
  replicateBlockReason,
  isReplicating,
}: {
  draft: AllocationDraft | null;
  /** Sprint do draft (#91): dela vêm as semanas oferecidas. `null` sem draft. */
  sprint: Sprint | null;
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
  const [weekStart, setWeekStart] = useState<number | null>(null);
  const [weekEnd, setWeekEnd] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const ticketsListRef = useRef<HTMLDivElement>(null);
  const prevTicketsCount = useRef(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const ticketRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Primeira linha com erro VISÍVEL na renderização anterior (-1 = nenhuma);
  // só rola quando o erro aparece, não a cada tecla (issue #70).
  const prevFirstShownProblem = useRef(-1);
  // Linha de link com foco: o erro de esquema fica adiado nela (issue #70).
  const [focusedUrlIndex, setFocusedUrlIndex] = useState<number | null>(null);
  // Linha levada ao foco pelo clique no Salvar bloqueado: nela o erro não é
  // mais adiado, senão o foco escondia justamente o motivo (issue #70).
  const [revealedUrlIndex, setRevealedUrlIndex] = useState<number | null>(null);
  const idPrefix = useId();

  useEffect(() => {
    // Trocar/fechar o draft nunca deve deixar a confirmação de exclusão aberta.
    setConfirming(false);
    if (!draft) return;
    setTitle(draft.title ?? "");
    setTickets(draft.tickets ?? []);
    setStatus(draft.status ?? "nao_especificada");
    setTipo(draft.tipo ?? "planejado");
    setNotes(draft.notes ?? "");
    // Sprint editada depois pode ter menos semanas que o card guarda: exibe o
    // valor já cortado (salvar grava o cortado).
    const weeks = sprint
      ? clampWeeksToSprint(
          { week_start: draft.week_start ?? null, week_end: draft.week_end ?? null },
          sprint,
        )
      : { week_start: draft.week_start ?? null, week_end: draft.week_end ?? null };
    setWeekStart(weeks.week_start);
    setWeekEnd(weeks.week_start == null ? null : (weeks.week_end ?? weeks.week_start));
    // Evita que o carregamento inicial dos tickets do draft seja lido como
    // "linha adicionada" pelo efeito de auto-scroll abaixo (abrir uma demanda
    // com vários tickets já deve mostrar do topo, não pular pro último).
    prevTicketsCount.current = (draft.tickets ?? []).length;
    // Demanda aberta já com link inválido deve rolar até ele (issue #70).
    prevFirstShownProblem.current = -1;
    setRevealedUrlIndex(null);
    // `sprint` entra só para o corte inicial; reexecutar quando ele muda
    // (refetch em segundo plano) apagaria a edição em andamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const weeks = useMemo(() => (sprint ? sprintWeeks(sprint) : []), [sprint]);

  const onWeekStartChange = (v: string) => {
    if (v === NO_WEEK) {
      setWeekStart(null);
      setWeekEnd(null);
      return;
    }
    const n = Number(v);
    setWeekStart(n);
    // Final vazia ou menor que a nova inicial: acompanha a inicial.
    if (weekEnd == null || weekEnd < n) setWeekEnd(n);
  };

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
  // Quando os dois lados já foram editados e divergem, o aviso inline
  // (`ticketKeyMismatch`, issue #50) é que aponta o problema.
  const handleTicketKeyChange = (index: number, value: string) =>
    setTickets((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        // Comparação com a chave antiga sem validar: cobre link legado /browse/FOO.
        const wasAutoDerived = !t.url || t.url === jiraUrlFor(t.key.trim().toUpperCase());
        if (!wasAutoDerived || !value.trim()) return { key: value, url: t.url };
        // Só chave válida gera link (issue #52); texto qualquer fica sem link.
        const next = normalizeJiraKey(value);
        return { key: value, url: next ? jiraUrlFor(next) : null };
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

  // Correções em um clique do aviso de divergência (issue #50). Cada uma
  // alinha um lado ao outro; a derivação automática acima não entra aqui.
  const setTicketAt = (index: number, ticket: AllocationTicket) =>
    setTickets((prev) => prev.map((t, i) => (i === index ? ticket : t)));

  /** Cola vários links/chaves Jira de uma vez (um por linha, espaço ou vírgula) e expande em linhas. */
  const handleTicketPaste = (
    index: number,
    field: "key" | "url",
    e: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    const text = e.clipboardData.getData("text");
    const parsed = parseTicketTokens(text);
    // Mais de um http(s):// no texto colado nunca vai para o colar nativo,
    // mesmo que vire uma linha só depois de tirar os repetidos (issue #51).
    // O mesmo vale para vários tokens que colapsam em um ticket, como
    // "PIM-1 <link de PIM-1>": só texto de um único token cola nativo (issue #71).
    if (parsed.length <= 1 && ticketUrlProblem(text) !== "varios" && !/[\s,]/.test(text.trim())) {
      const [token] = parsed;
      // Token único: o texto colado é o próprio token.
      const isUrl = /^https?:\/\//i.test(text.trim());
      if (token && !token.key && token.url) {
        toast.warning(
          "Link colado não tem uma chave Jira reconhecida — preencha a chave manualmente.",
        );
      }
      // URL colada no campo de chave: sem isso a URL inteira vira a chave e o
      // link derivado sai quebrado. Distribui a URL entre chave e link.
      if (field === "key" && token && isUrl) {
        e.preventDefault();
        setTickets((prev) =>
          prev.map((t, i) => (i === index ? { key: token.key, url: token.url } : t)),
        );
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
    const invalidKeys = parsed.filter((t) => ticketKeyProblem(t) !== null).length;
    if (invalidKeys > 0) {
      toast.warning(
        `${invalidKeys} item(ns) colado(s) não é(são) chave Jira (ex.: ${project}-123) — corrija ou remova a linha.`,
      );
    }
    const fromOther = parsed.filter((t) => ticketProjectMismatch(t, project) !== null).length;
    if (fromOther > 0) {
      toast.warning(
        `${fromOther} ticket(s) colado(s) de outro projeto — confira se são do ${project}.`,
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
      // Sprint e pessoa vêm da célula clicada (novo) e só mudam arrastando o
      // card na grade — o diálogo nunca as altera.
      const payload = {
        title: title.trim(),
        tickets: tickets
          .filter((t) => t.key.trim() || t.url?.trim())
          .map((t) => ({ key: t.key.trim().toUpperCase(), url: t.url?.trim() || null })),
        status,
        tipo,
        notes: notes.trim() || null,
        week_start: weekStart,
        week_end: weekStart == null ? null : (weekEnd ?? weekStart),
      };
      const res = draft.id
        ? await supabase.from("allocations").update(payload).eq("id", draft.id)
        : await supabase.from("allocations").insert({
            ...payload,
            sprint_id: draft.sprint_id,
            dev_id: draft.dev_id,
            jira_project: project,
          });
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e, "allocation")),
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
    if (weekStart !== (draft.week_start ?? null)) return true;
    if (weekStart != null && (weekEnd ?? weekStart) !== (draft.week_end ?? draft.week_start))
      return true;
    const a = normalizedTickets(tickets);
    const b = normalizedTickets(draft.tickets ?? []);
    if (a.length !== b.length) return true;
    return a.some((t, i) => t.key !== b[i]!.key || t.url !== b[i]!.url);
  })();

  // Link e chave inválidos bloqueiam o Salvar (issues #51 e #52); o erro
  // aparece na própria linha. Só a regra do link existe no banco (CHECK
  // allocations_ticket_urls_valid); a da chave é só do cliente.
  const hasTicketUrlProblem = tickets.some((t) => ticketUrlProblem(t.url) !== null);
  const hasTicketKeyProblem = tickets.some((t) => ticketKeyProblem(t) !== null);

  // Problema de link EXIBIDO (issue #70): o erro de esquema fica oculto
  // enquanto a pessoa ainda digita "h", "http:/"... na própria linha — senão
  // aparece já na primeira letra. O bloqueio do Salvar usa o problema REAL.
  const shownUrlProblemAt = (t: AllocationTicket, i: number) => {
    const problem = ticketUrlProblem(t.url);
    return problem === "esquema" &&
      focusedUrlIndex === i &&
      revealedUrlIndex !== i &&
      isPartialHttpScheme(t.url ?? "")
      ? null
      : problem;
  };
  const rowHasShownProblem = (t: AllocationTicket, i: number) =>
    ticketKeyProblem(t) !== null || shownUrlProblemAt(t, i) !== null;

  // Leva a pessoa até o que impede o Salvar: rola até a primeira linha com
  // problema REAL (pode estar fora da área visível de `max-h-32`) e foca o
  // campo inválido.
  const revealFirstTicketProblem = () => {
    const index = tickets.findIndex(
      (t) => ticketUrlProblem(t.url) !== null || ticketKeyProblem(t) !== null,
    );
    const row = index >= 0 ? ticketRowRefs.current[index] : null;
    if (!row) return;
    setRevealedUrlIndex(index);
    row.scrollIntoView({ block: "nearest" });
    (
      row.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ??
      row.querySelector<HTMLInputElement>('input[data-field="url"]')
    )?.focus();
  };

  // Quando um erro aparece (não a cada tecla), rola até ele sem mover o foco.
  // Declarado DEPOIS do auto-scroll de linha adicionada: ao colar vários
  // tickets com um inválido, o erro vence o "rolar para o fim" (issue #70).
  const firstShownProblem = tickets.findIndex((t, i) => rowHasShownProblem(t, i));
  useEffect(() => {
    if (firstShownProblem >= 0 && firstShownProblem !== prevFirstShownProblem.current) {
      ticketRowRefs.current[firstShownProblem]?.scrollIntoView({ block: "nearest" });
    }
    prevFirstShownProblem.current = firstShownProblem;
  }, [firstShownProblem]);

  // Por que o Salvar está bloqueado (issue #70). Mesmo raciocínio do Replicar:
  // `disabled` não explica nada e sai da ordem de tabulação.
  const saveBlockReason = !title.trim()
    ? "Preencha o nome da demanda."
    : hasTicketUrlProblem
      ? "Corrija o link do ticket."
      : hasTicketKeyProblem
        ? "Corrija a chave do ticket."
        : null;

  const remove = useMutation({
    mutationFn: async () => {
      if (!draft?.id) return;
      const { error } = await supabase.from("allocations").delete().eq("id", draft.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      setConfirming(false);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e, "allocation")),
  });

  return (
    <>
      <Dialog open={!!draft} onOpenChange={onOpenChange}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar demanda" : "Nova demanda"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Demanda</Label>
              <Input
                id="title"
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Cadastro massivo de medidores"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="alloc-status">Status</Label>
                {/* Férias ignora o status: desabilita sem resetar, para restaurar o valor ao trocar de tipo. */}
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as AllocationStatus)}
                  disabled={!hasSpecStatus(tipo)}
                >
                  <SelectTrigger id="alloc-status">
                    <SelectValue>{hasSpecStatus(tipo) ? undefined : "Não se aplica"}</SelectValue>
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
                <Label htmlFor="alloc-tipo">Tipo</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as AllocationTipo)}>
                  <SelectTrigger id="alloc-tipo">
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

            {weeks.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="alloc-week-start">Semana inicial</Label>
                  <Select
                    value={weekStart == null ? NO_WEEK : String(weekStart)}
                    onValueChange={onWeekStartChange}
                  >
                    <SelectTrigger id="alloc-week-start">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_WEEK}>Sem semana</SelectItem>
                      {weeks.map((w) => (
                        <SelectItem key={w.number} value={String(w.number)}>
                          {weekLabel(w)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alloc-week-end">Semana final</Label>
                  {/* Sem inicial não há o que terminar: desabilita. Só lista
                      semanas >= inicial (final nunca antes da inicial). */}
                  <Select
                    value={weekStart == null ? "" : String(weekEnd ?? weekStart)}
                    onValueChange={(v) => setWeekEnd(Number(v))}
                    disabled={weekStart == null}
                  >
                    <SelectTrigger id="alloc-week-end">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {weeks
                        .filter((w) => weekStart != null && w.number >= weekStart)
                        .map((w) => (
                          <SelectItem key={w.number} value={String(w.number)}>
                            {weekLabel(w)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Tickets</Label>
              <div className="space-y-2">
                {/* max-h-32 ≈ 3 linhas (h-9 cada + gap-2) — a 4ª em diante rola só
                  aqui dentro, sem esticar o diálogo inteiro. Auto-rola para o
                  fim ao adicionar linha, para a mais nova ficar sempre visível. */}
                <div ref={ticketsListRef} className="max-h-32 space-y-2 overflow-y-auto pr-1">
                  {tickets.map((t, i) => {
                    const linked = ticketKeyMismatch(t);
                    const typed = t.key.trim().toUpperCase();
                    const shownUrlProblem = shownUrlProblemAt(t, i);
                    const keyProblem = ticketKeyProblem(t);
                    const otherProject = ticketProjectMismatch(t, project);
                    // Ids das mensagens, ligados aos inputs por aria-describedby
                    // (issue #70). Sem role="alert": o erro de chave aparece a
                    // cada tecla e viraria ruído no leitor de tela; o foco no
                    // input inválido (revealFirstTicketProblem) já faz o leitor
                    // ler a descrição.
                    const keyErrId = `${idPrefix}-ticket-${i}-key`;
                    const projectWarnId = `${idPrefix}-ticket-${i}-project`;
                    const urlErrId = `${idPrefix}-ticket-${i}-url`;
                    const linkedWarnId = `${idPrefix}-ticket-${i}-linked`;
                    const keyDescribedBy =
                      [keyProblem ? keyErrId : null, otherProject ? projectWarnId : null]
                        .filter(Boolean)
                        .join(" ") || undefined;
                    const urlDescribedBy =
                      [shownUrlProblem ? urlErrId : null, linked ? linkedWarnId : null]
                        .filter(Boolean)
                        .join(" ") || undefined;
                    return (
                      <div
                        key={i}
                        className="space-y-1"
                        ref={(el) => {
                          ticketRowRefs.current[i] = el;
                        }}
                      >
                        <div className="flex gap-2">
                          <div className="grid flex-1 grid-cols-2 gap-2">
                            <Input
                              value={t.key}
                              onChange={(e) => handleTicketKeyChange(i, e.target.value)}
                              onPaste={(e) => handleTicketPaste(i, "key", e)}
                              placeholder="PIM-7862"
                              aria-label="Chave do ticket"
                              aria-invalid={keyProblem ? true : undefined}
                              aria-describedby={keyDescribedBy}
                              data-field="key"
                            />
                            <Input
                              value={t.url ?? ""}
                              onChange={(e) => handleTicketUrlChange(i, e.target.value)}
                              onPaste={(e) => handleTicketPaste(i, "url", e)}
                              onFocus={() => setFocusedUrlIndex(i)}
                              onBlur={() => setFocusedUrlIndex(null)}
                              placeholder="https://..."
                              aria-label="Link do ticket"
                              aria-invalid={shownUrlProblem ? true : undefined}
                              aria-describedby={urlDescribedBy}
                              data-field="url"
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
                        {keyProblem ? (
                          <p id={keyErrId} className="text-xs text-destructive">
                            "{t.key.trim()}" não é uma chave Jira (ex.: {project}-123). Corrija a
                            chave ou remova a linha.
                          </p>
                        ) : null}
                        {otherProject ? (
                          <p
                            id={projectWarnId}
                            className="text-xs text-amber-600 dark:text-amber-400"
                          >
                            {normalizeJiraKey(t.key)} é do projeto {otherProject}, não do {project}.
                          </p>
                        ) : null}
                        {shownUrlProblem === "esquema" ? (
                          <p id={urlErrId} className="text-xs text-destructive">
                            O link precisa começar com http:// ou https://.
                          </p>
                        ) : null}
                        {shownUrlProblem === "varios" ? (
                          <p
                            id={urlErrId}
                            className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
                          >
                            <span>Há mais de um link neste campo.</span>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() =>
                                setTicketAt(i, { key: t.key, url: firstTicketUrl(t.url ?? "") })
                              }
                            >
                              Manter só o primeiro
                            </Button>
                          </p>
                        ) : null}
                        {linked ? (
                          <p
                            id={linkedWarnId}
                            className="flex flex-wrap items-center gap-x-2 text-xs text-amber-600 dark:text-amber-400"
                          >
                            <span>
                              O link aponta para {linked}, não para {typed}.
                            </span>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => setTicketAt(i, { key: linked, url: t.url })}
                            >
                              Usar {linked}
                            </Button>
                            {normalizeJiraKey(typed) ? (
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={() =>
                                  setTicketAt(i, { key: typed, url: jiraUrlFor(typed) })
                                }
                              >
                                Trocar link para {typed}
                              </Button>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
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
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-4" /> Excluir
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
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
                      aria-label="Replicar na próxima sprint"
                      aria-disabled={isDirty || !!replicateBlockReason || isReplicating}
                      onClick={() => {
                        if (isDirty || replicateBlockReason || isReplicating) return;
                        onReplicate();
                      }}
                    >
                      <Copy className="size-4" /> Replicar
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
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* aria-disabled (não `disabled`), como no Replicar: o botão
                    segue focável e o motivo do bloqueio aparece por hover e por
                    teclado (issue #70). O clique barrado leva a pessoa ao campo
                    que precisa de correção. */}
                  <Button
                    className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                    aria-disabled={!!saveBlockReason || save.isPending}
                    onClick={() => {
                      if (save.isPending) return;
                      if (saveBlockReason) {
                        if (!title.trim()) titleRef.current?.focus();
                        else revealFirstTicketProblem();
                        return;
                      }
                      save.mutate();
                    }}
                  >
                    Salvar
                  </Button>
                </TooltipTrigger>
                {saveBlockReason ? <TooltipContent>{saveBlockReason}</TooltipContent> : null}
              </Tooltip>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir demanda?</AlertDialogTitle>
            <AlertDialogDescription>
              {title.trim()
                ? `A demanda "${title.trim()}" será excluída permanentemente.`
                : "A demanda será excluída permanentemente."}
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
    week_start: a.week_start,
    week_end: a.week_end,
  };
}
