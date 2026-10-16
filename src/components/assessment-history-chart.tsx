"use client";

import { format, parseISO } from "date-fns";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { AssessmentView } from "@/services/assessments.ts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export function AssessmentHistoryChart({ test }: { test: AssessmentView }) {
  const chartConfig = {
    value: { label: test.primaryLabel, color: "var(--color-ds-purple-700)" },
  } satisfies ChartConfig;
  const chartData = [...test.history].reverse().map((row) => ({
    date: format(parseISO(row.completedAt), "MMM d"),
    value: row.primary,
  }));
  if (chartData.filter((row) => row.value != null).length < 2) return null;

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-36 w-full">
      <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(value) => String(Math.round(Number(value)))}
          domain={["auto", "auto"]}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={1.75}
          dot={{ r: 3 }}
          name={test.primaryLabel}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
