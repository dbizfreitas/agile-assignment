import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeIssueGroups, isStoryType, makeIsHeader } from "@/lib/compromisso/calc";
import type { IssueResponse } from "@/lib/compromisso/types";

const CATEGORY_BADGE: Record<string, string> = {
  done: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30",
  indeterminate: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  new: "bg-muted text-muted-foreground border-border",
};

const TYPE_BADGE: Record<string, string> = {
  story: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  sub: "bg-muted text-muted-foreground border-border",
  bug: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  improvement: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
  task: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

function typeKind(t: string): keyof typeof TYPE_BADGE {
  if (isStoryType(t)) return "story";
  if (t === "Subtarefa" || t === "Sub-task") return "sub";
  if (t === "Bug") return "bug";
  if (t.toLowerCase().includes("melho")) return "improvement";
  if (t === "Tarefa" || t === "Task") return "task";
  return "other";
}

function typeRank(t: string): number {
  const kind = typeKind(t);
  if (kind === "story") return 0;
  if (kind === "sub") return 1;
  if (kind === "task") return 2;
  if (kind === "improvement") return 3;
  if (kind === "bug") return 5;
  return 4;
}

function catRank(c: string): number {
  if (c === "done") return 0;
  if (c === "indeterminate") return 1;
  return 2;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[typeKind(type)]}`}
    >
      {type}
    </span>
  );
}

function StatusPill({ status, category }: { status: string; category: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_BADGE[category] ?? CATEGORY_BADGE["new"]}`}
    >
      {status}
    </span>
  );
}

function DaysInStatus({ d }: { d: number | null }) {
  if (d == null) return <span className="text-muted-foreground">—</span>;
  if (d === 0) return <span className="text-muted-foreground text-[11px]">&lt;1d</span>;
  const tier =
    d <= 3
      ? { cls: "text-green-600 dark:text-green-400", mark: "" }
      : d <= 7
        ? { cls: "text-amber-600 dark:text-amber-400", mark: "▲ " }
        : d <= 14
          ? { cls: "text-blue-600 dark:text-blue-400", mark: "◆ " }
          : { cls: "text-red-600 dark:text-red-400", mark: "■ " };
  return (
    <span
      className={`font-semibold ${tier.cls}`}
      title={`${d} dia${d === 1 ? "" : "s"} no status atual`}
    >
      {tier.mark}
      {d}d
    </span>
  );
}

type SortCol = "key" | "type" | "summary" | "assignee" | "reviewer" | "days_in_status" | "sp";

function sortVal(item: IssueResponse, col: SortCol): string | number {
  if (col === "key") return item.key ?? "";
  if (col === "type") return item.type ?? "";
  if (col === "summary") return item.summary ?? "";
  if (col === "assignee") return item.assignee ?? "";
  if (col === "reviewer") return item.reviewer ?? "";
  if (col === "days_in_status") return item.days_in_status ?? -1;
  if (col === "sp") return item.sp ?? -1;
  return "";
}

export function IssuesTable({
  vis,
  all,
  singleStatus,
  showReviewer,
}: {
  vis: IssueResponse[];
  all: IssueResponse[];
  singleStatus: boolean;
  showReviewer: boolean;
}) {
  const [sort, setSort] = useState<{ col: SortCol | null; dir: 1 | -1 }>({ col: null, dir: 1 });

  const isHeader = useMemo(() => makeIsHeader(computeIssueGroups(all)), [all]);
  const { parentsWithSubs } = useMemo(() => computeIssueGroups(all), [all]);

  function toggleSort(col: SortCol) {
    setSort((s) => (s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: 1 }));
  }

  const rows = useMemo(
    () => buildRows(vis, all, singleStatus, sort, isHeader, parentsWithSubs),
    [vis, all, singleStatus, sort, isHeader, parentsWithSubs],
  );

  const colCount = 7 + (showReviewer ? 1 : 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-semibold">Demandas</CardTitle>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {vis.length}
        </span>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <SortableHead
                col="key"
                label="Chave"
                enabled={singleStatus}
                sort={sort}
                onSort={toggleSort}
              />
              <SortableHead
                col="type"
                label="Tipo"
                enabled={singleStatus}
                sort={sort}
                onSort={toggleSort}
              />
              <TableHead>Status</TableHead>
              <SortableHead
                col="summary"
                label="Resumo"
                enabled={singleStatus}
                sort={sort}
                onSort={toggleSort}
              />
              <SortableHead
                col="assignee"
                label="Responsável"
                enabled={singleStatus}
                sort={sort}
                onSort={toggleSort}
              />
              {showReviewer ? (
                <SortableHead
                  col="reviewer"
                  label="Reviewer"
                  enabled={singleStatus}
                  sort={sort}
                  onSort={toggleSort}
                />
              ) : null}
              <SortableHead
                col="days_in_status"
                label="Dias no status"
                enabled={singleStatus}
                sort={sort}
                onSort={toggleSort}
                className="whitespace-nowrap"
              />
              <SortableHead
                col="sp"
                label="SP"
                enabled={singleStatus}
                sort={sort}
                onSort={toggleSort}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  Nenhum item encontrado
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) =>
                row.kind === "group" ? (
                  <TableRow key={`g-${row.status}`} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={colCount}>
                      <StatusPill status={row.status} category={row.category} />
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.count} iten{row.count !== 1 ? "s" : ""}
                      </span>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.item.key} className={row.isParent ? "font-medium" : undefined}>
                    <TableCell className="text-xs text-muted-foreground">{row.rowNum}</TableCell>
                    <TableCell>
                      <a
                        href={row.item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${row.indent ? "pl-4" : ""}`}
                      >
                        {row.item.key}
                        <ExternalLink className="size-2.5 opacity-50" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={row.item.type} />
                    </TableCell>
                    <TableCell>
                      <StatusPill status={row.item.status} category={row.item.statusCategory} />
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={row.item.summary}>
                      {row.item.summary}
                    </TableCell>
                    <TableCell>{row.item.assignee}</TableCell>
                    {showReviewer ? <TableCell>{row.item.reviewer ?? "—"}</TableCell> : null}
                    <TableCell>
                      <DaysInStatus d={row.item.days_in_status} />
                    </TableCell>
                    <TableCell className="font-semibold">{row.spCell}</TableCell>
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SortableHead({
  col,
  label,
  enabled,
  sort,
  onSort,
  className,
}: {
  col: SortCol;
  label: string;
  enabled: boolean;
  sort: { col: SortCol | null; dir: 1 | -1 };
  onSort: (col: SortCol) => void;
  className?: string;
}) {
  if (!enabled) return <TableHead className={className}>{label}</TableHead>;
  const active = sort.col === col;
  const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className={`size-3 ${active ? "text-primary" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

type ItemRow = {
  kind: "item";
  item: IssueResponse;
  rowNum: string;
  indent: boolean;
  isParent: boolean;
  spCell: string | number;
};
type GroupRow = { kind: "group"; status: string; category: string; count: number };
type Row = ItemRow | GroupRow;

function buildRows(
  vis: IssueResponse[],
  all: IssueResponse[],
  singleStatus: boolean,
  sort: { col: SortCol | null; dir: 1 | -1 },
  isHeader: (i: IssueResponse) => boolean,
  parentsWithSubs: Set<string>,
): Row[] {
  if (!vis.length) return [];

  const isGroupRow = (i: IssueResponse) =>
    !i.isSubtask && (parentsWithSubs.has(i.key) || isStoryType(i.type));
  const visKeys = new Set(vis.map((i) => i.key));
  const compare = (a: IssueResponse, b: IssueResponse) => {
    if (!sort.col) return 0;
    const va = sortVal(a, sort.col);
    const vb = sortVal(b, sort.col);
    if (typeof va === "string") return sort.dir * va.localeCompare(vb as string, "pt-BR");
    return sort.dir * ((va as number) - (vb as number));
  };

  function parentRow(parent: IssueResponse, visSubs: IssueResponse[], rowNum: string): ItemRow {
    return {
      kind: "item",
      item: parent,
      rowNum,
      indent: false,
      isParent: true,
      spCell: visSubs.length > 0 ? "—" : (parent.sp ?? "—"),
    };
  }

  function subRow(sub: IssueResponse, rowNum: string): ItemRow {
    return {
      kind: "item",
      item: sub,
      rowNum,
      indent: true,
      isParent: false,
      spCell: sub.sp ?? "—",
    };
  }

  function plainRow(item: IssueResponse, rowNum: string): ItemRow {
    return {
      kind: "item",
      item,
      rowNum,
      indent: false,
      isParent: false,
      spCell: isHeader(item) ? "—" : (item.sp ?? "—"),
    };
  }

  const rows: Row[] = [];
  const rendered = new Set<string>();

  if (singleStatus) {
    let rowNum = 0;
    const rootItems = vis.filter((i) => !i.isSubtask || !visKeys.has(i.parent ?? ""));
    if (sort.col) rootItems.sort(compare);

    rootItems.forEach((item) => {
      if (rendered.has(item.key)) return;
      rowNum++;
      rendered.add(item.key);
      if (isGroupRow(item)) {
        const visSubs = all
          .filter((i) => i.isSubtask && i.parent === item.key && visKeys.has(i.key))
          .sort((a, b) => a.key.localeCompare(b.key));
        visSubs.forEach((s) => rendered.add(s.key));
        rows.push(parentRow(item, visSubs, String(rowNum)));
        visSubs.forEach((s, idx) => rows.push(subRow(s, `${rowNum}.${idx + 1}`)));
      } else {
        rows.push(plainRow(item, String(rowNum)));
      }
    });
    return rows;
  }

  let rowNum = 0;
  const groups = new Map<string, { category: string; items: IssueResponse[] }>();
  vis.forEach((i) => {
    const g = groups.get(i.status) ?? { category: i.statusCategory, items: [] };
    g.items.push(i);
    groups.set(i.status, g);
  });
  const sortedGroups = [...groups.entries()].sort(
    ([, a], [, b]) => catRank(a.category) - catRank(b.category),
  );

  sortedGroups.forEach(([status, { category, items }]) => {
    rows.push({ kind: "group", status, category, count: items.length });

    const parents = items.filter(isGroupRow).sort((a, b) => a.key.localeCompare(b.key));
    const others = items.filter((i) => !isGroupRow(i));

    parents.forEach((parent) => {
      const visSubs = all
        .filter((i) => i.isSubtask && i.parent === parent.key && visKeys.has(i.key))
        .sort((a, b) => a.key.localeCompare(b.key));
      rowNum++;
      visSubs.forEach((s) => rendered.add(s.key));
      rows.push(parentRow(parent, visSubs, String(rowNum)));
      visSubs.forEach((s, idx) => rows.push(subRow(s, `${rowNum}.${idx + 1}`)));
    });

    others
      .filter((i) => !rendered.has(i.key) && !(i.isSubtask && i.parent && visKeys.has(i.parent)))
      .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.key.localeCompare(b.key))
      .forEach((item) => {
        rowNum++;
        rendered.add(item.key);
        rows.push(plainRow(item, String(rowNum)));
      });
  });

  return rows;
}
