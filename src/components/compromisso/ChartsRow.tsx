import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { computeSPChartData, computeStatusChartData } from "@/lib/compromisso/charts-data";
import type { SprintDataLike } from "@/lib/compromisso/calc";
import type { IssueResponse } from "@/lib/compromisso/types";

const CATEGORY_COLOR: Record<string, string> = {
  done: "#22c55e",
  indeterminate: "#f59e0b",
  new: "#64748b",
};

const spChartConfig: ChartConfig = {
  done: { label: "Done", color: "#22c55e" },
  resto: { label: "Resto", color: "var(--color-primary)" },
};

export function ChartsRow({
  vis,
  all,
  sprintData,
}: {
  vis: IssueResponse[];
  all: IssueResponse[];
  sprintData: SprintDataLike | null | undefined;
}) {
  const statusData = computeStatusChartData(vis);
  const spData = computeSPChartData(vis, all, sprintData);

  const statusChartConfig: ChartConfig = Object.fromEntries(
    statusData.map((d) => [
      d.status,
      { label: d.status, color: CATEGORY_COLOR[d.category] ?? "#64748b" },
    ]),
  );

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Status</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ChartContainer config={statusChartConfig} className="aspect-auto h-56 w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="status" />} />
              <Pie
                data={statusData}
                dataKey="count"
                nameKey="status"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={1}
              >
                {statusData.map((d) => (
                  <Cell key={d.status} fill={CATEGORY_COLOR[d.category] ?? "#64748b"} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="status" />} />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">SP por Responsável</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ChartContainer config={spChartConfig} className="aspect-auto h-56 w-full">
            <BarChart data={spData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="assignee" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={32} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="done"
                name="Done"
                stackId="sp"
                fill="var(--color-done)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="resto"
                name="Resto"
                stackId="sp"
                fill="var(--color-resto)"
                radius={[4, 4, 0, 0]}
              />
              <ChartLegend />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
