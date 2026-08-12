import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  sortIssues,
  speedTier,
  totalTier,
  type CycleTimeFixedCol,
  type CycleTimeSort,
  type SpeedTier,
} from "@/lib/cycle-time/calc";
import type { CycleTimeIssue } from "@/lib/cycle-time/types";

// Limiares do original, tokens do destino — legíveis nos dois temas.
const TIER_CLASS: Record<SpeedTier, string> = {
  rápido: "text-green-600 dark:text-green-400",
  médio: "text-amber-600 dark:text-amber-400",
  lento: "text-red-600 dark:text-red-400",
};

export function CycleTimeTable({
  title,
  subtitle,
  issues,
  columns,
  fmt,
  pageSize,
}: {
  title: string;
  subtitle: string | null;
  issues: CycleTimeIssue[];
  columns: string[];
  fmt: (d: number | undefined) => string;
  /** `null` desliga a paginação — é o caso da sub-visão "Em Andamento". */
  pageSize: number | null;
}) {
  const [sort, setSort] = useState<CycleTimeSort | null>(null);
  const [page, setPage] = useState(0);

  // Ordena a lista INTEIRA e fatia depois, nunca o contrário: paginar antes de
  // ordenar faria a ordenação valer só para a página visível.
  const sorted = useMemo(() => sortIssues(issues, sort), [issues, sort]);

  const total = sorted.length;
  const paginated = pageSize != null && total > pageSize;
  const pages = paginated && pageSize != null ? Math.ceil(total / pageSize) : 1;
  const safePage = Math.min(page, pages - 1);
  const start = paginated && pageSize != null ? safePage * pageSize : 0;
  const rows = paginated && pageSize != null ? sorted.slice(start, start + pageSize) : sorted;
  const colCount = columns.length + 6;

  function toggleFixed(col: CycleTimeFixedCol) {
    // Trocar de coluna de ordenação volta para a página 1 — igual ao original.
    setPage(0);
    setSort((s) =>
      s && s.kind === "fixed" && s.col === col
        ? { kind: "fixed", col, dir: (s.dir * -1) as 1 | -1 }
        : { kind: "fixed", col, dir: 1 },
    );
  }

  function toggleStatus(col: string) {
    setPage(0);
    setSort((s) =>
      s && s.kind === "status" && s.col === col
        ? { kind: "status", col, dir: (s.dir * -1) as 1 | -1 }
        : { kind: "status", col, dir: 1 },
    );
  }

  const info = paginated
    ? `Página ${safePage + 1} de ${pages} · itens ${start + 1}–${Math.min(start + rows.length, total)} de ${total}`
    : "";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {total} {total === 1 ? "item" : "itens"}
        </span>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-0">
        {paginated ? (
          <PaginationBar
            info={info}
            atFirst={safePage === 0}
            atLast={safePage >= pages - 1}
            onPrev={() => setPage(Math.max(0, safePage - 1))}
            onNext={() => setPage(Math.min(pages - 1, safePage + 1))}
          />
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <SortHead
                label="Chave"
                active={sort?.kind === "fixed" && sort.col === "key"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("key")}
              />
              <SortHead
                label="Resumo"
                active={sort?.kind === "fixed" && sort.col === "summary"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("summary")}
              />
              <SortHead
                label="Status atual"
                active={sort?.kind === "fixed" && sort.col === "current_status"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("current_status")}
              />
              <SortHead
                label="Versões corrigidas"
                active={sort?.kind === "fixed" && sort.col === "fix_versions"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("fix_versions")}
              />
              {columns.map((st) => (
                <SortHead
                  key={st}
                  label={st}
                  active={sort?.kind === "status" && sort.col === st}
                  dir={sort?.dir ?? 1}
                  onClick={() => toggleStatus(st)}
                  className="text-center"
                />
              ))}
              <SortHead
                label="Total"
                active={sort?.kind === "fixed" && sort.col === "total"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("total")}
                className="text-center"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  Nenhum item em andamento
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow key={row.key}>
                  <TableCell className="text-xs text-muted-foreground">{start + idx + 1}</TableCell>
                  <TableCell>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 whitespace-nowrap underline-offset-2 hover:underline"
                    >
                      {row.key}
                      <ExternalLink className="size-2.5 opacity-50" />
                    </a>
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={row.summary}>
                    {row.summary}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {row.current_status}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {row.fix_versions}
                  </TableCell>
                  {columns.map((st) => {
                    const d = row.status_days[st];
                    if (d === undefined || d === 0) {
                      return (
                        <TableCell
                          key={st}
                          className="text-center text-muted-foreground"
                          aria-label="sem dados"
                        >
                          —
                        </TableCell>
                      );
                    }
                    return (
                      <DurationCell
                        key={st}
                        days={d}
                        fmt={fmt}
                        tier={speedTier(d)}
                        prefix=""
                        bold={false}
                      />
                    );
                  })}
                  <DurationCell
                    days={row.total_days}
                    fmt={fmt}
                    tier={totalTier(row.total_days)}
                    prefix="Total: "
                    bold
                  />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {paginated ? (
          <PaginationBar
            info={info}
            atFirst={safePage === 0}
            atLast={safePage >= pages - 1}
            onPrev={() => setPage(Math.max(0, safePage - 1))}
            onNext={() => setPage(Math.min(pages - 1, safePage + 1))}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  const Icon = active ? (dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
      >
        {label}
        <Icon className={`size-3 ${active ? "text-primary" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

function PaginationBar({
  info,
  atFirst,
  atLast,
  onPrev,
  onNext,
}: {
  info: string;
  atFirst: boolean;
  atLast: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Dois botões e um contador — não o primitivo @/components/ui/pagination,
  // que é feito para lista numerada de páginas com elipse e não é usado por
  // nenhuma outra tela desta aplicação.
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-xs text-muted-foreground">
      <Button variant="outline" size="sm" onClick={onPrev} disabled={atFirst}>
        Anterior
      </Button>
      <span>{info}</span>
      <Button variant="outline" size="sm" onClick={onNext} disabled={atLast}>
        Próxima
      </Button>
    </div>
  );
}

function DurationCell({
  days,
  fmt,
  tier,
  prefix,
  bold,
}: {
  days: number;
  fmt: (d: number | undefined) => string;
  tier: SpeedTier;
  prefix: string;
  bold: boolean;
}) {
  const text = fmt(days);
  // title + aria-label com duração e rótulo de velocidade: é o que dá leitura
  // acessível a uma matriz de números coloridos.
  return (
    <TableCell
      className={`text-center ${bold ? "font-bold" : "font-semibold"} ${TIER_CLASS[tier]}`}
      title={`${prefix}${text} — ${tier}`}
      aria-label={`${tier}: ${text}`}
    >
      {text}
    </TableCell>
  );
}
