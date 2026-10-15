"use client";

import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  useEventCalendarSelector,
  useEventCalendarViewConfig,
} from "@/components/reui/event-calendar/event-calendar";
import type { CalendarView } from "@/components/reui/event-calendar/event-calendar-types";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";

const DEFAULT_VIEW_COMPONENTS = {
  month: lazy(() =>
    import("@/components/reui/event-calendar/event-calendar-month-view").then((mod) => ({
      default: mod.EventCalendarMonthView,
    })),
  ),
  week: lazy(() =>
    import("@/components/reui/event-calendar/event-calendar-time-grid").then((mod) => ({
      default: mod.EventCalendarWeekView,
    })),
  ),
  day: lazy(() =>
    import("@/components/reui/event-calendar/event-calendar-time-grid").then((mod) => ({
      default: mod.EventCalendarDayView,
    })),
  ),
  days: lazy(() =>
    import("@/components/reui/event-calendar/event-calendar-time-grid").then((mod) => ({
      default: mod.EventCalendarDaysView,
    })),
  ),
  agenda: lazy(() =>
    import("@/components/reui/event-calendar/event-calendar-agenda-view").then((mod) => ({
      default: mod.EventCalendarAgendaView,
    })),
  ),
  resource: lazy(() =>
    import("@/components/reui/event-calendar/event-calendar-resource-view").then((mod) => ({
      default: mod.EventCalendarResourceView,
    })),
  ),
} as Record<CalendarView, ComponentType>;

interface EventCalendarContentProps extends Omit<useRender.ComponentProps<"div">, "children"> {
  /** Swap individual view implementations. */
  components?: Partial<Record<CalendarView, ComponentType>>;
  /** Replaces the switchboard entirely; read useEventCalendarView() inside. */
  children?: ReactNode;
}

function EventCalendarContent({
  className,
  render,
  components,
  children,
  ...props
}: EventCalendarContentProps) {
  const viewConfig = useEventCalendarViewConfig();
  const view = useEventCalendarSelector((state) => state.view);
  const loading = useEventCalendarSelector((state) => state.loading);

  const resolved = {
    ...DEFAULT_VIEW_COMPONENTS,
    ...viewConfig.components,
    ...components,
  };
  // A spread copies keys that hold `undefined`, so `components={{ month: isPro
  // ? ProMonth : undefined }}` would erase the default and render <undefined />.
  const ActiveView = resolved[view] ?? DEFAULT_VIEW_COMPONENTS[view];

  const defaultProps = {
    "data-slot": "event-calendar-content",
    "data-view": view,
    "data-loading": loading || undefined,
    className: cn(
      "relative flex min-h-0 min-w-0 flex-1 flex-col",
      "data-loading:pointer-events-none data-loading:opacity-60",
      viewConfig.classNames?.content,
      className,
    ),
    children: children ?? (
      <Suspense fallback={<Skeleton className="min-h-80 flex-1 rounded-none" />}>
        <ActiveView />
      </Suspense>
    ),
  };

  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(defaultProps, props),
  });
}

export { DEFAULT_VIEW_COMPONENTS, EventCalendarContent };
export type { EventCalendarContentProps };
