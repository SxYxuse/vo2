"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { CheckIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";

import { routePlansQueryOptions } from "@/lib/queries.ts";
import { formatDistanceKm, formatElevation } from "@/services/activity-detail.types.ts";
import { formatSportType } from "@/services/calendar-settings.types.ts";
import { planningProducts, type FuelProduct } from "@/services/fuel-catalog.ts";
import {
  formatAroundTime,
  MAX_CARBS_PER_HOUR,
  swapOptions,
  type FuelPlan,
  type Intake,
} from "@/services/fuel-plan.ts";
import {
  carryList,
  chooseFuelPlan,
  deleteRoutePlan,
  repredictRoutePlan,
  swapFuelProduct,
  updateRoutePlan,
  type RoutePlanView,
} from "@/services/route-plan.ts";
import { BottleFields } from "@/components/route-bottle-fields.tsx";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const CHART_CONFIG = {
  altitudeM: { label: "Elevation", color: "var(--color-ds-gray-700)" },
} satisfies ChartConfig;

const PRODUCTS = planningProducts();
const nameOf = (id: string) => PRODUCTS.find((product) => product.id === id)?.name ?? id;

/** A change to the route; the list and this route's view both read from "route-plans". */
function useRoutePlanMutation<T>(fn: (value: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: routePlansQueryOptions.queryKey });
    },
  });
}

export function RoutePlanDetail({ plan }: { plan: RoutePlanView }) {
  const { prediction } = plan;
  const similar = prediction.basis.similar.length;
  const group =
    prediction.sportGroup === "cycling"
      ? "ride"
      : prediction.sportGroup === "running"
        ? "run"
        : "hike";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{plan.name}</h1>
        <p className="text-muted-foreground text-sm">
          {formatSportType(plan.sportType)} · predicted from{" "}
          {similar > 0
            ? `${similar} similar ${group}${similar > 1 ? "s" : ""}`
            : "your speed by gradient"}
          <Badge variant="outline" className="ms-2 align-middle">
            {prediction.basis.confidence} confidence
          </Badge>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          label="Time"
          value={`~${formatAroundTime(prediction.elapsedSec)}`}
          hint="from start to finish"
        />
        <StatCard label="Moving" value={`~${formatAroundTime(prediction.movingSec)}`} />
        <StatCard label="Distance" value={formatDistanceKm(prediction.distanceM)} />
        <StatCard label="Climbing" value={formatElevation(prediction.gainM)} />
      </div>

      {prediction.basis.warnings.length > 0 || plan.catalogChanged ? (
        <Alert>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-4">
              {prediction.basis.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {plan.catalogChanged ? (
                <li>
                  The MNSTRY catalog changed since this plan was made. Save the settings to refresh
                  it.
                </li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <ElevationProfile plan={plan} />

      {prediction.climbs.length > 0 ? (
        <section aria-label="Major climbs" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Major climbs</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {prediction.climbs.map((climb) => (
              <li
                key={climb.startSec}
                className="flex flex-wrap justify-between gap-x-3 px-3 py-2 tabular-nums"
              >
                <span>
                  around {formatAroundTime(climb.startSec)} · km {climb.startKm}–{climb.endKm}
                </span>
                <span className="text-muted-foreground">
                  {climb.gainM} m at {climb.avgGradePct ?? "—"} %, ~
                  {Math.round(climb.durationSec / 60)} min
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PlanSettings plan={plan} />
      <Proposals plan={plan} />
      {plan.chosen ? <ChosenPlan plan={plan} chosen={plan.chosen} /> : null}
      <RouteActions plan={plan} />
    </div>
  );
}

function ElevationProfile({ plan }: { plan: RoutePlanView }) {
  const solids = plan.chosen?.intakes.filter((intake) => intake.role !== "drink") ?? [];
  if (!plan.prediction.hasElevation) return null;
  return (
    <ChartContainer config={CHART_CONFIG} className="aspect-auto h-40 w-full sm:h-56">
      <AreaChart data={plan.profile} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="km"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickFormatter={(value) => `${Math.round(Number(value))} km`}
        />
        <YAxis
          dataKey="altitudeM"
          width={40}
          tickLine={false}
          axisLine={false}
          domain={["dataMin - 20", "dataMax + 20"]}
          tickFormatter={(value) => `${Math.round(Number(value))}`}
        />
        {plan.prediction.climbs.map((climb) => (
          <ReferenceArea
            key={climb.startSec}
            x1={climb.startKm}
            x2={climb.endKm}
            fill="var(--color-ds-amber-700)"
            fillOpacity={0.12}
          />
        ))}
        {solids.map((intake) => (
          <ReferenceLine
            key={`${intake.atSec}-${intake.productId}`}
            x={intake.km}
            stroke="var(--color-ds-blue-700)"
            strokeDasharray="2 3"
          />
        ))}
        <Area
          dataKey="altitudeM"
          type="monotone"
          stroke="var(--color-altitudeM)"
          fill="var(--color-altitudeM)"
          fillOpacity={0.15}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function PlanSettings({ plan }: { plan: RoutePlanView }) {
  const [carbTarget, setCarbTarget] = useState(String(plan.carbTarget));
  const [bottles, setBottles] = useState({
    bottleCount: plan.bottleCount,
    bottleMl: plan.bottleMl,
  });
  const update = useRoutePlanMutation(() =>
    updateRoutePlan({
      data: { id: plan.id, carbTarget: Number(carbTarget), ...bottles },
    }),
  );
  const target = Number(carbTarget);
  const valid =
    carbTarget.trim() !== "" &&
    Number.isFinite(target) &&
    target >= 0 &&
    target <= MAX_CARBS_PER_HOUR;
  const changed =
    target !== plan.carbTarget ||
    bottles.bottleCount !== plan.bottleCount ||
    bottles.bottleMl !== plan.bottleMl ||
    plan.catalogChanged;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Target and bottles</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={!valid}>
            <FieldLabel htmlFor="plan-carbs">Carbs per hour</FieldLabel>
            <Input
              id="plan-carbs"
              type="text"
              inputMode="numeric"
              className="max-w-32"
              value={carbTarget}
              onChange={(event) => setCarbTarget(event.target.value)}
            />
            {!valid ? (
              <FieldDescription>Enter 0 to {MAX_CARBS_PER_HOUR} g per hour.</FieldDescription>
            ) : null}
          </Field>
          <BottleFields
            idPrefix="plan"
            count={bottles.bottleCount}
            ml={bottles.bottleMl}
            onChange={(next) => setBottles((current) => ({ ...current, ...next }))}
          />
        </FieldGroup>
      </CardContent>
      {changed ? (
        <CardFooter>
          <Button disabled={!valid || update.isPending} onClick={() => update.mutate(undefined)}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Update plans
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function summary(plan: FuelPlan) {
  const parts: string[] = [];
  if (plan.drink)
    parts.push(
      `${plan.drink.quarters / 4} bottle${plan.drink.quarters > 4 ? "s" : ""} ${nameOf(plan.drink.productId)}`,
    );
  for (const item of plan.items) parts.push(`${item.count} × ${nameOf(item.productId)}`);
  return parts;
}

function Proposals({ plan }: { plan: RoutePlanView }) {
  const choose = useRoutePlanMutation((proposalId: string) =>
    chooseFuelPlan({ data: { id: plan.id, proposalId } }),
  );
  const chosenId = plan.chosen?.spec.id;
  return (
    <section aria-label="Fuel plans" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Fuel plans</h2>
      {/* One card per screen width on phones, swiped sideways; side by side on desktop. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
        {plan.proposals.map((proposal) => {
          const isChosen = chosenId === proposal.spec.id;
          return (
            <Card
              key={proposal.spec.id}
              size="sm"
              className="w-[85%] shrink-0 snap-center md:w-auto"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {proposal.spec.name}
                  {isChosen ? <Badge>Chosen</Badge> : null}
                </CardTitle>
                <CardDescription>{proposal.spec.rationale}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="tabular-nums">
                  <span className="font-medium">{proposal.achievedGph} g/h</span>
                  <span className="text-muted-foreground">
                    {" "}
                    of {proposal.carbTarget} · {proposal.totalCarbsG} g
                  </span>
                  {proposal.caffeineMg > 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {proposal.caffeineMg} mg caffeine
                    </span>
                  ) : null}
                </p>
                <ul className="text-muted-foreground flex flex-col gap-0.5">
                  {summary(proposal).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {[...proposal.notes, ...proposal.issues].map((note) => (
                  <p key={note} className="text-xs">
                    {note}
                  </p>
                ))}
              </CardContent>
              <CardFooter>
                <Button
                  variant={isChosen ? "outline" : "default"}
                  disabled={choose.isPending}
                  onClick={() => choose.mutate(proposal.spec.id)}
                >
                  {choose.isPending && choose.variables === proposal.spec.id ? (
                    <Spinner data-icon="inline-start" />
                  ) : isChosen ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : null}
                  {isChosen ? "Reset to this plan" : "Choose"}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
      {choose.error ? <p className="text-destructive text-sm">{choose.error.message}</p> : null}
    </section>
  );
}

function intakeAmount(intake: Intake) {
  if (intake.role === "drink") return "¼ bottle";
  return intake.amount === 1 ? "1" : `${intake.amount}`;
}

function ChosenPlan({ plan, chosen }: { plan: RoutePlanView; chosen: FuelPlan }) {
  const [swapping, setSwapping] = useState<string | null>(null);
  const swap = useRoutePlanMutation((replacementId: string) =>
    swapFuelProduct({
      data: { id: plan.id, productId: swapping ?? "", replacementId },
    }),
  );
  const options: FuelProduct[] = swapping ? swapOptions(PRODUCTS, swapping) : [];

  return (
    <section
      aria-label="Your fuel plan"
      className="flex flex-col gap-3 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{chosen.spec.name}</h2>
        <p className="text-muted-foreground text-sm tabular-nums">
          {chosen.achievedGph} g/h · {chosen.totalCarbsG} g of carbs
          {chosen.caffeineMg > 0 ? ` · ${chosen.caffeineMg} mg caffeine` : ""}
        </p>
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>What to carry</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm">
            {carryList(chosen, PRODUCTS).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {[...chosen.notes, ...chosen.issues].map((note) => (
        <p key={note} className="text-muted-foreground text-sm">
          {note}
        </p>
      ))}
      <ol className="flex flex-col divide-y rounded-xl border">
        {chosen.intakes.map((intake) => (
          <li
            key={`${intake.atSec}-${intake.productId}-${intake.role}`}
            className="flex gap-3 px-3 py-2.5"
          >
            <div className="w-16 shrink-0 tabular-nums">
              <div className="font-medium">~{formatAroundTime(intake.atSec)}</div>
              <div className="text-muted-foreground text-xs">km {intake.km}</div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <button
                type="button"
                className="min-h-8 text-start font-medium underline-offset-4 hover:underline"
                onClick={() => setSwapping(intake.productId)}
              >
                {intakeAmount(intake)} {nameOf(intake.productId)}
              </button>
              <span className="text-muted-foreground text-xs">
                {Math.round(intake.carbsG)} g carbs
                {intake.caffeineMg > 0 ? ` · ${intake.caffeineMg} mg caffeine` : ""}
                {intake.role !== "drink"
                  ? intake.withFluid
                    ? " · with a sip"
                    : " · on its own"
                  : ""}{" "}
                · {intake.reason}
              </span>
              <span className="text-muted-foreground text-xs">
                between {formatAroundTime(intake.earliestSec)} and{" "}
                {formatAroundTime(intake.latestSec)}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <ResponsiveDialog
        open={swapping != null}
        onOpenChange={(open) => (open ? null : setSwapping(null))}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Swap {swapping ? nameOf(swapping) : ""}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              The plan recalculates servings and times to keep your target.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ul className="flex max-h-[60vh] flex-col divide-y overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={swap.isPending}
                  className="hover:bg-muted/50 flex min-h-12 w-full items-center justify-between gap-3 py-2 text-start"
                  onClick={() => swap.mutate(option.id, { onSuccess: () => setSwapping(null) })}
                >
                  <span className="font-medium">{option.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {option.carbsG} g{option.glucoseFructose ? ` · ${option.glucoseFructose}` : ""}
                    {option.caffeineMg ? ` · ${option.caffeineMg} mg` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {swap.error ? (
            <p className="text-destructive px-4 pb-4 text-sm">{swap.error.message}</p>
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </section>
  );
}

function RouteActions({ plan }: { plan: RoutePlanView }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const repredict = useRoutePlanMutation(() => repredictRoutePlan({ data: { id: plan.id } }));
  const remove = useMutation({
    mutationFn: () => deleteRoutePlan({ data: { id: plan.id } }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: [...routePlansQueryOptions.queryKey, plan.id] });
      void queryClient.invalidateQueries({ queryKey: routePlansQueryOptions.queryKey });
      await navigate({ to: "/fuel" });
    },
  });

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <Button
        variant="outline"
        disabled={repredict.isPending}
        onClick={() => repredict.mutate(undefined)}
      >
        {repredict.isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RefreshCwIcon data-icon="inline-start" />
        )}
        Predict again
      </Button>
      <Button variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
        <Trash2Icon data-icon="inline-start" />
        Delete route
      </Button>
      <p className="text-muted-foreground w-full text-xs">
        Predict again after new activities are copied or your form changes.
      </p>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !remove.isPending && setConfirming(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this route?</AlertDialogTitle>
            <AlertDialogDescription>
              Its prediction and fuel plans are removed. Your activities are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
