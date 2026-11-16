import type { ComponentType, ReactNode } from "react";
import { cn } from "cn";

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  back,
  className,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col gap-1", className)}>
      {back}
      <div className="flex min-h-[2.75rem] items-center justify-between gap-3 sm:min-h-8">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          {Icon ? <Icon aria-hidden className="size-5 shrink-0" /> : null}
          <span className="min-w-0 truncate">{title}</span>
        </h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
      ) : null}
    </div>
  );
}
