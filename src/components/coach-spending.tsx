"use client";

import { useQuery } from "@tanstack/react-query";

import { coachSpendingQueryOptions } from "@/lib/queries.ts";
import { COACH_FEATURES } from "@/services/coach-models.ts";
import type { CoachSpendingMonth } from "@/services/coach-usage.ts";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const count = new Intl.NumberFormat("en-US");

/** A cent rounds most single answers to $0.00, which would read as free. */
function costText(usd: number) {
  return usd > 0 && usd < 0.01 ? "< $0.01" : dollars.format(usd);
}

function Month({ label, month }: { label: string; month: CoachSpendingMonth }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{costText(month.costUsd)}</span>
      </div>
      {month.costUsd > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {COACH_FEATURES.map(
            (feature) => `${feature.label} ${costText(month.byFeature[feature.id])}`,
          ).join(" · ")}
        </span>
      ) : null}
      {month.unpricedCalls > 0 ? (
        <span className="text-xs text-muted-foreground">
          Plus {count.format(month.unpricedCalls)} {month.unpricedCalls === 1 ? "call" : "calls"} (
          {count.format(month.unpricedTokens)} tokens) whose provider reported no cost, as OpenAI
          never does.
        </span>
      ) : null}
    </div>
  );
}

/** Settings → Coach: what the coach cost on the athlete's own keys, this month and last. */
export function CoachSpendingSection() {
  const { data, isError } = useQuery(coachSpendingQueryOptions);
  return (
    <FieldSet>
      <FieldLegend>Spending</FieldLegend>
      <FieldDescription>
        What the coach cost on your keys, as each provider reported it. Your provider's own
        dashboard has the final bill.
      </FieldDescription>
      {data ? (
        <div className="flex flex-col gap-2">
          <Month label="This month" month={data.thisMonth} />
          <Month label="Last month" month={data.lastMonth} />
        </div>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">Spending shows once you're back online.</p>
      ) : null}
    </FieldSet>
  );
}
