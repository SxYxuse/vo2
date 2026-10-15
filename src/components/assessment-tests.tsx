import { BikeIcon, FlaskConicalIcon, FootprintsIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { formatHours } from "#/services/training-plan.ts";
import {
  formatAssessmentResult,
  type AssessmentHistoryRow,
  type AssessmentStatus,
  type AssessmentView,
} from "#/services/assessments.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function statusLabel(status: AssessmentStatus) {
  if (status === "suggested") return "Suggested";
  if (status === "fatigued") return "Wait for form";
  if (status === "recent") return "Done recently";
  if (status === "no-sport") return "No sport slot";
  return "Off";
}

function statusVariant(status: AssessmentStatus) {
  if (status === "suggested") return "success" as const;
  if (status === "fatigued") return "warning" as const;
  if (status === "recent") return "info" as const;
  return "outline" as const;
}

function sportTone(family: AssessmentView["family"]) {
  return family === "cycling" ? "text-ds-blue-700" : "text-ds-amber-700";
}

function deltaVariant(delta: number) {
  if (delta > 0) return "success" as const;
  if (delta < 0) return "destructive" as const;
  return "outline" as const;
}

function formatDelta(delta: number, unit: string) {
  const sign = delta > 0 ? "+" : "";
  const value = Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
  return `${sign}${value} ${unit}`;
}

function HistorySection({ test }: { test: AssessmentView }) {
  const history = test.history;
  if (!history.length) {
    return (
      <p className="text-muted-foreground text-xs">
        No flagged results yet. After you do this protocol, open the activity and flag it as{" "}
        {test.title}.
      </p>
    );
  }
  const chartConfig = {
    value: { label: test.primaryLabel, color: "var(--color-ds-purple-700)" },
  } satisfies ChartConfig;
  const chartData = [...history].reverse().map((row) => ({
    date: format(parseISO(row.completedAt), "MMM d"),
    value: row.primary,
  }));
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-medium text-sm">Results over time</h2>
      {chartData.filter((row) => row.value != null).length >= 2 ? (
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
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((row: AssessmentHistoryRow) => (
            <TableRow key={row.id}>
              <TableCell>{format(parseISO(row.completedAt), "MMM d, yyyy")}</TableCell>
              <TableCell>{formatAssessmentResult(test.id, row.result)}</TableCell>
              <TableCell>
                {row.delta != null ? (
                  <Badge variant={deltaVariant(row.delta)}>
                    {formatDelta(row.delta, test.primaryUnit)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AssessmentTests({ tests }: { tests: AssessmentView[] }) {
  const suggested = tests.filter((test) => test.status === "suggested");

  return (
    <div className="flex flex-col gap-4">
      {suggested.length ? (
        <Alert variant="success">
          <FlaskConicalIcon />
          <AlertTitle>
            {suggested.length === 1 ? "One test is due" : `${suggested.length} tests are due`}
          </AlertTitle>
          <AlertDescription>
            Form looks good. Do these on a fresh day — they are not mixed into the weekly bucket.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info">
          <FlaskConicalIcon />
          <AlertTitle>Nothing to suggest right now</AlertTitle>
          <AlertDescription>
            Protocols stay here. Turn tests on in Settings, wait until form recovers, or wait until
            the last 8 weeks lapse.
          </AlertDescription>
        </Alert>
      )}
      {tests.map((test) => {
        const SportIcon = test.family === "cycling" ? BikeIcon : FootprintsIcon;
        return (
          <Card key={test.id}>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <SportIcon className={sportTone(test.family)} />
                {test.title}
              </CardTitle>
              <CardDescription>
                {formatHours(test.minutes / 60)} · {test.family === "cycling" ? "Ride" : "Run"} ·{" "}
                {test.gear}
              </CardDescription>
              <CardAction>
                <Badge variant={statusVariant(test.status)}>{statusLabel(test.status)}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-4">
              <p className="text-sm">{test.why}</p>
              <p className="text-muted-foreground text-xs">{test.source}</p>
              <p className="text-muted-foreground text-xs">{test.statusNote}</p>
              <div className="flex flex-col gap-2">
                <h2 className="font-medium text-sm">How to do it</h2>
                <ol className="flex flex-col gap-2 text-sm">
                  {test.protocol.map((step, index) => (
                    <li key={step} className="flex gap-2">
                      <span className="text-muted-foreground font-mono tabular-nums">
                        {index + 1}.
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="font-medium text-sm">How to score it</h2>
                <ul className="flex flex-col gap-2 text-sm">
                  {test.scoring.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
              {test.caveats.length ? (
                <div className="flex flex-col gap-2">
                  <h2 className="font-medium text-sm">Limits</h2>
                  <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
                    {test.caveats.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <HistorySection test={test} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
