import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeSPSummaryData } from "@/lib/compromisso/calc";
import type { IssueResponse } from "@/lib/compromisso/types";
import type { ViewMode } from "./CompromissoSidebar";

export function SPSummaryCard({
  vis,
  all,
  viewMode,
}: {
  vis: IssueResponse[];
  all: IssueResponse[];
  viewMode: ViewMode;
}) {
  const { rows, totalSP, ignoredSP, noSPItems, headers, countable } = computeSPSummaryData(
    vis,
    all,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          {viewMode === "done"
            ? "Detalhamento de SP por origem — Concluídos"
            : "Detalhamento de SP por origem — Todos os itens"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead>SP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  {row.labelHref ? (
                    <a
                      href={row.labelHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {row.label}
                    </a>
                  ) : (
                    row.label
                  )}
                </TableCell>
                <TableCell>{row.items}</TableCell>
                <TableCell className="font-semibold">{row.sp}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>TOTAL</TableCell>
              <TableCell>—</TableCell>
              <TableCell>{totalSP}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Total
            label="Total de itens"
            value={vis.length}
            sub={`${countable} contáveis + ${headers} cabeçalhos`}
          />
          <Total label="SP contabilizados" value={`${totalSP} SP`} />
          <Total label="SP ignorados (cabeçalhos c/ filhas pontuadas)" value={`${ignoredSP} SP`} />
          <Total
            label="Itens sem SP"
            value={noSPItems.length}
            sub={noSPItems.map((i) => i.key).join(", ")}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Total({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub ? (
        <div className="truncate text-[10px] text-muted-foreground" title={sub}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}
