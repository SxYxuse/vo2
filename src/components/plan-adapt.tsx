"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowRightIcon } from "lucide-react";

import { afterPlanChanged } from "@/lib/query-events.ts";
import { seasonChangeQueryOptions } from "@/lib/queries.ts";
import { adaptPlan } from "@/services/plan-builder.ts";
import type { SeasonCheck } from "@/services/plan-builder.types.ts";
import type { PlanImpact } from "@/services/plan-impact.ts";
import { eventTitle, seasonEvents } from "@/services/season.types.ts";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

/** The goals behind a season change, in words: "Gravel des Monts (B)". */
export function changedGoalsLabel(impact: PlanImpact) {
  const goals = [...impact.added, ...impact.edited, ...impact.removed];
  return seasonEvents(goals)
    .map((event) => `${eventTitle(event)} (${event.goals[0]!.priority})`)
    .join(", ");
}

function weekLabel(weekStart: string) {
  return format(parseISO(`${weekStart}T12:00:00`), "d MMM");
}

/** Says what a goal change did to the plan when it went in without asking. */
export function notifySeasonCheck(check: SeasonCheck | null) {
  if (check?.adopted) {
    toast.add({ type: "success", title: "Added to your plan", description: check.adopted });
  }
}

/**
 * Which weeks a season change reshapes, and the choice to adapt the plan or keep it (ADR 0026).
 * A kept plan stays as it is; This week keeps a reminder until it is adapted.
 */
export function AdaptPlanDialog({
  impact,
  open,
  onOpenChange,
}: {
  impact: PlanImpact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const adapt = useMutation({
    mutationFn: () => adaptPlan(),
    onSuccess: async () => {
      queryClient.setQueryData(seasonChangeQueryOptions.queryKey, null);
      onOpenChange(false);
      await afterPlanChanged(queryClient);
      toast.add({ type: "success", title: "Plan adapted to your season" });
    },
  });
  const shown = impact?.changes.slice(0, 6) ?? [];
  const more = (impact?.changes.length ?? 0) - shown.length;

  return (
    <ResponsiveDialog open={open && impact != null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Your plan needs to adapt</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {impact
              ? `${changedGoalsLabel(impact)} changes these weeks of your current block.`
              : null}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ul className="flex flex-col gap-2 px-4 text-sm sm:px-0">
          {shown.map((change) => (
            <li key={change.weekStart} className="flex flex-col gap-0.5 rounded-lg border p-2.5">
              <span className="text-muted-foreground text-xs font-medium">
                Week of {weekLabel(change.weekStart)}
              </span>
              <span className="text-muted-foreground line-through">{change.before}</span>
              <span className="flex items-start gap-1.5 font-medium">
                <ArrowRightIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {change.after}
              </span>
            </li>
          ))}
          {more > 0 ? (
            <li className="text-muted-foreground text-xs">
              And {more} more {more === 1 ? "week" : "weeks"}.
            </li>
          ) : null}
        </ul>
        <p className="text-muted-foreground px-4 text-xs sm:px-0">
          Days you've already trained stay as they are. Keeping the plan leaves a reminder on This
          week.
        </p>
        {adapt.error ? (
          <p className="text-destructive px-4 text-xs sm:px-0">{adapt.error.message}</p>
        ) : null}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={adapt.isPending}>
            Keep current plan
          </Button>
          <Button onClick={() => adapt.mutate()} disabled={adapt.isPending}>
            {adapt.isPending ? <Spinner data-icon="inline-start" /> : null}
            Adapt plan
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Opens the adapt dialog right after a goal change that reshapes the current block. */
export function SeasonChangePrompt() {
  const queryClient = useQueryClient();
  const { data: impact = null } = useQuery(seasonChangeQueryOptions);
  return (
    <AdaptPlanDialog
      impact={impact}
      open={impact != null}
      onOpenChange={(open) => {
        if (!open) queryClient.setQueryData(seasonChangeQueryOptions.queryKey, null);
      }}
    />
  );
}
