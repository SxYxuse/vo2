"use client";

import { createContext, use, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  useEventCalendar,
  useEventCalendarSelector,
  useEventCalendarViewConfig,
  useEventCalendarViewContext,
} from "@/components/reui/event-calendar/event-calendar";
import {
  markChipPress,
  useEventCalendarGestures,
  wasRecentDrag,
} from "@/components/reui/event-calendar/event-calendar-dnd";
import {
  spansMultipleDays,
  toZoned,
  zonedStartOfDay,
} from "@/components/reui/event-calendar/event-calendar-lib";
import type {
  EventCalendarOccurrence,
  EventCalendarSegment,
} from "@/components/reui/event-calendar/event-calendar-types";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { addDays, format } from "date-fns";

import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RepeatIcon } from "lucide-react";

const EVENT_CALENDAR_COLORS: Array<{ name: string; value: string }> = [
  { name: "Blue", value: "var(--color-blue-500)" },
  { name: "Emerald", value: "var(--color-emerald-500)" },
  { name: "Violet", value: "var(--color-violet-500)" },
  { name: "Rose", value: "var(--color-rose-500)" },
  { name: "Amber", value: "var(--color-amber-500)" },
  { name: "Cyan", value: "var(--color-cyan-500)" },
  { name: "Orange", value: "var(--color-orange-500)" },
  { name: "Pink", value: "var(--color-pink-500)" },
  { name: "Teal", value: "var(--color-teal-500)" },
  { name: "Indigo", value: "var(--color-indigo-500)" },
];

const EVENT_CALENDAR_GHOST = {
  move: "rounded-sm border border-dashed border-(--ec-event-color)/50 bg-(--ec-event-color)/8",
  resize: "rounded-sm border border-dashed border-(--ec-event-color)/70 overflow-hidden",
  invalid: "border-destructive/70 bg-destructive/10",
  invalidResize: "border-destructive/70",
  invalidContent: "opacity-60",
} as const;

/**
 * Fade-out truncation for stacked timed blocks, where squeezed cascade
 * columns clip titles into a mash of glyphs; a right-edge mask fade reads
 * cleaner than an ellipsis at those widths. Masked ONLY below a 10rem
 * container: mask-image forces text off subpixel antialiasing, so masking
 * wide chips makes the whole grid read bolder and shimmer while resizing.
 * Wide chips keep the plain ellipsis. Exported for consumer renderEvent.
 */
const EVENT_CALENDAR_FADE_TRUNCATE =
  "w-full truncate @max-[10rem]:text-clip @max-[10rem]:[mask-image:linear-gradient(to_right,#000_calc(100%-0.75rem),transparent)] @max-[10rem]:rtl:[mask-image:linear-gradient(to_left,#000_calc(100%-0.75rem),transparent)]";

const EVENT_CALENDAR_SLOT_DRAFT = {
  box: "rounded-sm border border-dashed border-primary/40 bg-primary/5",
  segment: "border-y border-dashed border-primary/40",
  segmentStart: "rounded-s-sm border-s",
  segmentEnd: "rounded-e-sm border-e",
  surface: "bg-primary/5",
  label: "text-primary truncate px-1 py-0.5 text-[0.6875rem] leading-none font-medium",
} as const;

interface EventCalendarChipContextValue<TData = unknown> {
  occurrence: EventCalendarOccurrence<TData>;
  segment: EventCalendarSegment<TData>;
  isDragging: boolean;
  isSelected: boolean;
}

const EventCalendarChipContext = createContext<EventCalendarChipContextValue<any> | null>(null);

/** The chip's subject; usable inside renderEvent content and chip children. */
function useEventCalendarEventChip<TData = unknown>(): EventCalendarChipContextValue<TData> {
  const ctx = use(EventCalendarChipContext);
  if (!ctx) {
    throw new Error("useEventCalendarEventChip must be used within <EventCalendarEvent>");
  }
  return ctx as EventCalendarChipContextValue<TData>;
}

interface EventCalendarEventProps<TData = unknown> extends Omit<
  useRender.ComponentProps<"button">,
  "children"
> {
  segment: EventCalendarSegment<TData>;
  /** Replaces the default chip CONTENT; the wrapper stays calendar-owned. */
  children?: ReactNode;
  /**
   * Static drag clone: the chip as-is but inert - no gestures, resize
   * handles, selection/drag state, focus or pointer events.
   */
  preview?: boolean;
}

function EventCalendarEvent<TData = unknown>({
  segment,
  className,
  render,
  children,
  preview = false,
  ...props
}: EventCalendarEventProps<TData>) {
  const instance = useEventCalendar<TData>();
  const viewConfig = useEventCalendarViewConfig<TData>();
  const { view } = useEventCalendarViewContext();
  const gestures = useEventCalendarGestures<TData>();
  const { settings } = instance;
  const occurrence = segment.occurrence;
  const event = occurrence.event;

  const isSelectedRaw = useEventCalendarSelector<TData, boolean>(
    (state) => state.selection.eventKeys.includes(occurrence.key),
    { calendar: instance },
  );
  const isDraggingRaw = useEventCalendarSelector<TData, boolean>(
    (state) => state.drag?.occurrence.key === occurrence.key,
    { calendar: instance },
  );
  const resizeOn = useEventCalendarSelector<TData, boolean>((state) => state.interactions.resize, {
    calendar: instance,
  });
  const dragOn = useEventCalendarSelector<TData, boolean>((state) => state.interactions.drag, {
    calendar: instance,
  });
  const isSelected = preview ? false : isSelectedRaw;
  const isDragging = preview ? false : isDraggingRaw;

  const isBar = occurrence.allDay || spansMultipleDays(occurrence, settings.timeZone);
  const inTimeGrid = view === "week" || view === "day" || view === "days" || view === "resource";
  const interactive = view !== "agenda" && !preview;
  const timedBlock = inTimeGrid && !isBar;
  const horizontalBar = isBar && !inTimeGrid;
  const stackedBlock =
    timedBlock && (segment.endMin ?? 0) - (segment.startMin ?? 0) >= viewConfig.compactEventMinutes;

  const defaultContent = (
    <>
      {!timedBlock && (
        <span
          aria-hidden
          data-slot="event-calendar-event-dot"
          className="-me-0.5 size-1.5 shrink-0 rounded-full bg-(--ec-event-color)"
        />
      )}
      {occurrence.isRecurring && (
        <RepeatIcon className="size-2.5 shrink-0 opacity-70" aria-hidden="true" />
      )}
      <span className={cn("font-medium", stackedBlock ? EVENT_CALENDAR_FADE_TRUNCATE : "truncate")}>
        {event.title}
      </span>
      {!occurrence.allDay &&
        segment.isStart &&
        (view === "month" ? (
          <span className="text-muted-foreground shrink-0">
            {format(toZoned(occurrence.start, settings.timeZone), settings.i18n.formats.eventTime, {
              locale: settings.locale,
            })}
          </span>
        ) : (
          <span
            className={cn(
              "text-muted-foreground hidden @[8rem]:inline",
              stackedBlock ? EVENT_CALENDAR_FADE_TRUNCATE : "truncate",
            )}
          >
            {settings.i18n.functions.formatEventTime(
              toZoned(occurrence.start, settings.timeZone),
              toZoned(occurrence.end, settings.timeZone),
              occurrence.allDay,
              { locale: settings.locale },
            )}
          </span>
        ))}
    </>
  );

  const agendaTimeText = (() => {
    if (view !== "agenda") return "";
    if (occurrence.allDay) return settings.i18n.labels.allDay;
    const dayStart = zonedStartOfDay(segment.day, settings.timeZone);
    const dayEnd = addDays(toZoned(dayStart, settings.timeZone), 1);
    const startsBefore = occurrence.start < dayStart;
    const endsAfter = occurrence.end > dayEnd;
    if (startsBefore && endsAfter) return settings.i18n.labels.allDay;
    if (endsAfter) {
      return settings.i18n.labels.timeFrom(
        format(toZoned(occurrence.start, settings.timeZone), settings.i18n.formats.eventTime, {
          locale: settings.locale,
        }),
      );
    }
    if (startsBefore) {
      return settings.i18n.labels.timeUntil(
        format(toZoned(occurrence.end, settings.timeZone), settings.i18n.formats.eventTime, {
          locale: settings.locale,
        }),
      );
    }
    return settings.i18n.functions.formatEventTime(
      toZoned(occurrence.start, settings.timeZone),
      toZoned(occurrence.end, settings.timeZone),
      false,
      { locale: settings.locale },
    );
  })();

  const agendaDefaultContent = (
    <>
      <span className="text-muted-foreground w-40 shrink-0 truncate tabular-nums">
        {agendaTimeText}
      </span>
      <span
        aria-hidden
        data-slot="event-calendar-agenda-dot"
        className="size-2 shrink-0 rounded-full bg-(--ec-event-color)"
      />
      <span className="truncate text-sm">{event.title}</span>
      {occurrence.isRecurring && (
        <RepeatIcon className="text-muted-foreground size-2.5 shrink-0" aria-hidden="true" />
      )}
    </>
  );

  const customContent = useMemo(() => {
    const renderProps = { occurrence, segment, view, isDragging, isSelected };
    return view === "agenda"
      ? viewConfig.renderAgendaEvent?.(renderProps)
      : viewConfig.renderEvent?.(renderProps);
  }, [
    occurrence,
    segment,
    view,
    isDragging,
    isSelected,
    viewConfig.renderAgendaEvent,
    viewConfig.renderEvent,
  ]);
  const content =
    children ?? customContent ?? (view === "agenda" ? agendaDefaultContent : defaultContent);

  const timeLabel = settings.i18n.functions.formatEventTime(
    toZoned(occurrence.start, settings.timeZone),
    toZoned(occurrence.end, settings.timeZone),
    occurrence.allDay,
    { locale: settings.locale },
  );
  // native hover tooltip text; a formatter returning undefined drops the title
  const label = settings.i18n.functions.formatEventLabel
    ? settings.i18n.functions.formatEventLabel(event.title, timeLabel)
    : `${event.title}, ${timeLabel}`;

  const tooltipOpts = typeof viewConfig.eventTooltip === "object" ? viewConfig.eventTooltip : null;
  const tooltipContent =
    !preview && viewConfig.eventTooltip
      ? viewConfig.renderEventTooltip?.({
          occurrence,
          segment,
          view,
          label,
        }) || label
      : null;
  const tooltipOn = Boolean(tooltipContent);

  const showResize = interactive && resizeOn && !event.readOnly && event.resizable !== false;
  // touch-action: none lets a long press become a drag, but it also stops a
  // swipe that lands on the chip from scrolling the list, so only chips that
  // can actually move claim the touch
  const movable = interactive && dragOn && !event.readOnly && event.draggable !== false;
  const grip = (
    <span
      aria-hidden
      data-slot="event-calendar-resize-grip"
      className={cn(
        "bg-foreground/40 rounded-full",
        timedBlock ? "h-0.5 w-2.5" : "h-2.5 w-0.5",
        viewConfig.classNames?.resizeGrip,
      )}
    />
  );
  const resizeHandles = showResize && (
    <>
      {timedBlock && segment.isStart && (
        <span
          data-slot="event-calendar-resize-handle"
          data-edge="start"
          className={cn(
            "absolute inset-x-1 top-0 flex h-1.5 cursor-ns-resize items-center justify-center opacity-0 transition-opacity duration-150 group-hover/ec-event:opacity-100",
            viewConfig.classNames?.resizeHandle,
          )}
          onPointerDown={(e) => gestures.beginResize(e, segment, "start")}
        >
          {grip}
        </span>
      )}
      {timedBlock && segment.isEnd && (
        <span
          data-slot="event-calendar-resize-handle"
          data-edge="end"
          className={cn(
            "absolute inset-x-1 bottom-0 flex h-1.5 cursor-ns-resize items-center justify-center opacity-0 transition-opacity duration-150 group-hover/ec-event:opacity-100",
            viewConfig.classNames?.resizeHandle,
          )}
          onPointerDown={(e) => gestures.beginResize(e, segment, "end")}
        >
          {grip}
        </span>
      )}
      {(horizontalBar || (isBar && inTimeGrid)) && segment.isStart && (
        <span
          data-slot="event-calendar-resize-handle"
          data-edge="start"
          className={cn(
            "absolute inset-y-0 start-0 flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition-opacity duration-150 group-hover/ec-event:opacity-100",
            viewConfig.classNames?.resizeHandle,
          )}
          onPointerDown={(e) => gestures.beginResize(e, segment, "start")}
        >
          {grip}
        </span>
      )}
      {(horizontalBar || (isBar && inTimeGrid)) && segment.isEnd && (
        <span
          data-slot="event-calendar-resize-handle"
          data-edge="end"
          className={cn(
            "absolute inset-y-0 end-0 flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition-opacity duration-150 group-hover/ec-event:opacity-100",
            viewConfig.classNames?.resizeHandle,
          )}
          onPointerDown={(e) => gestures.beginResize(e, segment, "end")}
        >
          {grip}
        </span>
      )}
    </>
  );

  const defaultProps = {
    type: "button" as const,
    "data-slot": "event-calendar-event",
    "data-event-id": event.id,
    "data-view": view,
    "data-all-day": occurrence.allDay || undefined,
    "data-recurring": occurrence.isRecurring || undefined,
    "data-selected": isSelected || undefined,
    "data-dragging": isDragging || undefined,
    "data-preview": preview || undefined,
    "data-past": occurrence.end.getTime() < Date.now() || undefined,
    title: preview || tooltipOn ? undefined : label,
    "aria-label":
      settings.i18n.functions.formatEventAriaLabel?.(
        event.title,
        timeLabel,
        segment.continuesBefore || segment.continuesAfter,
      ) ??
      `${event.title}, ${timeLabel}${
        segment.continuesBefore || segment.continuesAfter
          ? `, ${settings.i18n.labels.continues}`
          : ""
      }`,
    "aria-pressed": interactive ? isSelected : undefined,
    "aria-hidden": preview || undefined,
    tabIndex: preview ? -1 : undefined,
    style: {
      "--ec-event-color": event.color ?? "var(--color-primary)",
    } as CSSProperties,
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      markChipPress();
      if (interactive) gestures.beginMove(e, segment);
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (wasRecentDrag()) return;
      settings.onEventClick?.(occurrence, e);
      if (e.defaultPrevented || view === "agenda") return;
      instance.api.selectEvent(occurrence.key);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      settings.onEventDoubleClick?.(occurrence, e);
    },
    className: cn(
      "group/ec-event text-foreground relative flex w-full min-w-0 cursor-pointer items-center overflow-hidden text-start select-none",
      movable && "touch-none",
      "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
      preview && "pointer-events-none",
      view === "agenda"
        ? "gap-3 rounded-md text-sm"
        : cn(
            "@container gap-1.5 rounded-sm px-1.5 py-1 leading-normal",
            "bg-(--ec-event-color)/20 hover:bg-(--ec-event-color)/30",
            "dark:bg-(--ec-event-color)/25 dark:hover:bg-(--ec-event-color)/35",
            "inset-ring inset-ring-(--ec-event-color)/15",
            "transition-[background-color,box-shadow] duration-150",
            "data-dragging:opacity-40",
            "data-selected:bg-(--ec-event-color)/30 data-selected:inset-ring-(--ec-event-color)/40",
            segment.continuesBefore && "rounded-s-none",
            segment.continuesAfter && "rounded-e-none",
          ),
      viewConfig.classNames?.event,
      event.className,
      className,
    ),
    children: (
      <>
        {content}
        {resizeHandles}
      </>
    ),
  };

  const chip = useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  });

  return (
    <EventCalendarChipContext.Provider value={{ occurrence, segment, isDragging, isSelected }}>
      {tooltipOn ? (
        <TooltipProvider delay={tooltipOpts?.delay ?? 600}>
          <Tooltip>
            <TooltipTrigger render={chip} />
            <TooltipContent
              side={tooltipOpts?.side ?? "top"}
              className={viewConfig.classNames?.eventTooltip}
            >
              {tooltipContent}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        chip
      )}
    </EventCalendarChipContext.Provider>
  );
}

export {
  EVENT_CALENDAR_COLORS,
  EVENT_CALENDAR_FADE_TRUNCATE,
  EVENT_CALENDAR_GHOST,
  EVENT_CALENDAR_SLOT_DRAFT,
  EventCalendarEvent,
  useEventCalendarEventChip,
};
export type { EventCalendarChipContextValue, EventCalendarEventProps };
