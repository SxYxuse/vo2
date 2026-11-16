"use client";

import { createContext, useContext, useRef, useState, type ComponentProps } from "react";
import { cn } from "cn";
import { InfoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Hover, focus, and press events a tap fires within this window are the tap itself, not hover. */
const TAP_WINDOW_MS = 800;

type TapHandlers = {
  onPointerDown: (pointerType: string) => void;
  onClick: () => void;
};

const TapTooltipContext = createContext<TapHandlers | null>(null);

type TapTooltipProps = Omit<
  ComponentProps<typeof Tooltip>,
  "open" | "defaultOpen" | "onOpenChange"
>;

export function TapTooltip(props: TapTooltipProps) {
  const [open, setOpen] = useState(false);
  const lastTapAt = useRef(0);
  const openAtTap = useRef(false);

  const handlers: TapHandlers = {
    onPointerDown(pointerType) {
      if (pointerType === "mouse") return;
      lastTapAt.current = Date.now();
      openAtTap.current = open;
    },
    onClick() {
      if (Date.now() - lastTapAt.current > TAP_WINDOW_MS) return;
      setOpen(!openAtTap.current);
    },
  };

  return (
    <TapTooltipContext.Provider value={handlers}>
      <Tooltip
        {...props}
        open={open}
        onOpenChange={(next, details) => {
          const fromTap = Date.now() - lastTapAt.current <= TAP_WINDOW_MS;
          if (fromTap && details.reason.startsWith("trigger-")) return;
          setOpen(next);
        }}
      />
    </TapTooltipContext.Provider>
  );
}

export function TapTooltipTrigger({
  onPointerDown,
  onClick,
  ...props
}: ComponentProps<typeof TooltipTrigger>) {
  const tap = useContext(TapTooltipContext);
  return (
    <TooltipTrigger
      {...props}
      onPointerDown={(event) => {
        tap?.onPointerDown(event.pointerType);
        onPointerDown?.(event);
      }}
      onClick={(event) => {
        tap?.onClick();
        onClick?.(event);
      }}
    />
  );
}

export { TooltipContent as TapTooltipContent };

export function InfoTooltip({
  label,
  children,
  className,
  iconClassName,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <TapTooltip>
      <TapTooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            className="relative after:absolute after:-inset-[0.8rem]"
          />
        }
      >
        <InfoIcon className={iconClassName} />
      </TapTooltipTrigger>
      <TooltipContent className={cn("max-w-72", className)}>{children}</TooltipContent>
    </TapTooltip>
  );
}
