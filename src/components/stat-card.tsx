import type { ReactNode } from "react";
import { cn } from "cn";

import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  info?: string;
  color?: string;
  className?: string;
  hintClassName?: string;
  valueClassName?: string;
  sparkline?: ReactNode;
};

export function StatCard({
  label,
  value,
  hint,
  info,
  color,
  className,
  hintClassName,
  valueClassName,
  sparkline,
}: StatCardProps) {
  return (
    <Card size="sm" className={cn("gap-1 py-3", className)}>
      <CardHeader className="px-3">
        <CardDescription className="flex items-center gap-1.5">
          {color ? (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          ) : null}
          <span className="min-w-0">{label}</span>
          {info ? <InfoTooltip label={`About ${label}`}>{info}</InfoTooltip> : null}
        </CardDescription>
        <CardTitle className={cn("font-mono text-base tabular-nums sm:text-lg", valueClassName)}>
          {value}
        </CardTitle>
        {hint ? <CardDescription className={hintClassName}>{hint}</CardDescription> : null}
        {sparkline}
      </CardHeader>
    </Card>
  );
}
