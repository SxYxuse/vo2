import type { ReactNode } from "react";
import { cn } from "cn";

import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { Badge } from "@/components/ui/badge";

export type StatTrend = {
  label: string;
  tone?: "success" | "warning" | "destructive" | "secondary";
};

export type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  info?: string;
  color?: string;
  /** Change or verdict shown as a badge under the value, e.g. "+1 by Sunday". */
  trend?: StatTrend;
  className?: string;
  hintClassName?: string;
  valueClassName?: string;
  sparkline?: ReactNode;
};

/**
 * One panel split into stat cells by hairlines, so a row of numbers reads as one object
 * instead of a grid of boxes. Pass the column classes; cells wrap onto new rows.
 */
export function StatGrid({
  className,
  footer,
  children,
}: {
  className?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card text-card-foreground ring-foreground/10 overflow-hidden rounded-lg ring-1">
      {/* The negative margins push the outer cell borders into the clipped edge. */}
      <div className={cn("-me-px -mb-px grid grid-cols-2", className)}>{children}</div>
      {footer ? <div className="border-foreground/10 border-t px-3 py-3">{footer}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  info,
  color,
  trend,
  className,
  hintClassName,
  valueClassName,
  sparkline,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "border-foreground/10 flex min-w-0 flex-col gap-1 border-e border-b p-3",
        className,
      )}
    >
      <div className="text-muted-foreground flex min-h-5 items-center gap-1.5 text-xs">
        {color ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
        {info ? <InfoTooltip label={`About ${label}`}>{info}</InfoTooltip> : null}
      </div>
      <div
        className={cn(
          "text-xl leading-tight font-semibold tracking-tight tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </div>
      {trend ? (
        <Badge variant={trend.tone ?? "secondary"} className="max-w-full">
          <span className="truncate">{trend.label}</span>
        </Badge>
      ) : null}
      {hint ? <p className={cn("text-muted-foreground text-xs", hintClassName)}>{hint}</p> : null}
      {sparkline}
    </div>
  );
}
