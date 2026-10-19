"use client";

import { setTrainingPeriod } from "@/hooks/use-training-period.ts";
import { FITNESS_PERIODS, type FitnessPeriod } from "@/services/training-load.ts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Period picker shared by every training view; changing it here changes it everywhere. */
export function PeriodToggle({ period }: { period: FitnessPeriod | null }) {
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      spacing={0}
      value={period ? [period] : []}
      onValueChange={(next) => {
        const value = next[0];
        const match = FITNESS_PERIODS.find((item) => item.id === value);
        if (match) setTrainingPeriod(match.id);
      }}
      className="flex-wrap"
    >
      {FITNESS_PERIODS.map((item) => (
        <ToggleGroupItem key={item.id} value={item.id}>
          <span className="sm:hidden">{item.shortLabel}</span>
          <span className="hidden sm:inline">{item.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
