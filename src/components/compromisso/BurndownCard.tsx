import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { computeBurndownData } from "@/lib/compromisso/burndown";
import type { SprintDataLike } from "@/lib/compromisso/calc";
import type { IssueResponse } from "@/lib/compromisso/types";

const chartConfig: ChartConfig = {
  ideal: { label: "Ideal (compromisso)", color: "hsl(215 20% 55%)" },
  actual: { label: "Compromisso", color: "var(--color-primary)" },
};

export function BurndownCard({
  sprintData,
  all,
}: {
  sprintData: SprintDataLike | null | undefined;
  all: IssueResponse[];
}) {
  const data = computeBurndownData(sprintData, all);
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-semibold">Burndown do Compromisso</CardTitle>
        <span className="text-xs font-medium text-muted-foreground">
          {data.totalSP} SP compromisso
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {data.keys.map((k) => (
            <span
              key={k.key}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                k.resolved
                  ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {k.key}
              {k.sp != null ? ` · ${k.sp} SP` : ""}
            </span>
          ))}
        </div>
        <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
          <LineChart data={data.points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              fontSize={11}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              fontSize={11}
              tickFormatter={(v: number) => `${v} SP`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="ideal"
              name="Ideal (compromisso)"
              type="linear"
              stroke="var(--color-ideal)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
            <Line
              dataKey="actual"
              name="Compromisso"
              type="monotone"
              stroke="var(--color-actual)"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
