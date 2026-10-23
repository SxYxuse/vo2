"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/responsive-dialog.tsx";
import { boardLabel, formatValue } from "@/components/personal-bests.tsx";
import { Button } from "@/components/ui/button";
import { topEffortCelebrationsQueryOptions } from "@/lib/queries.ts";
import {
  markTopEffortsSeen,
  type TopEffortCelebrations,
  type TopEffortPlacement,
} from "@/services/top-efforts.ts";

const SPORT_NOUN = { running: "run", cycling: "ride", swimming: "swim" };
const CARD_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
/** Past this many cards, dots give way to a "3 / 12" counter. */
const MAX_DOTS = 5;
/** A drag this far, in pixels, turns the card. */
const SWIPE_PX = 60;
/** The opening deal, from the first card's delay to the last card landing. */
const DEAL_MS = 1200;

/** Gold, silver, and bronze for the first three places all time; plain cards for the rest. */
const MEDAL: Record<number, CSSProperties> = {
  1: {
    background:
      "linear-gradient(160deg, oklch(0.95 0.08 95), oklch(0.8 0.15 85) 55%, oklch(0.68 0.14 70))",
  },
  2: {
    background:
      "linear-gradient(160deg, oklch(0.95 0.01 250), oklch(0.82 0.02 250) 55%, oklch(0.7 0.02 250))",
  },
  3: {
    background:
      "linear-gradient(160deg, oklch(0.9 0.06 55), oklch(0.75 0.1 50) 55%, oklch(0.62 0.1 45))",
  },
};

function cardTitle(placement: TopEffortPlacement) {
  const label = boardLabel(placement);
  if (placement.kind === "power") return `${label} power`;
  if (placement.kind === "time") return `${label} ${SPORT_NOUN[placement.sport]}`;
  return `${label} · ${SPORT_NOUN[placement.sport]}`;
}

/** "All time · #1 in 2026", or "In 2026" for a place within the year only. A PB tops its year too. */
function rankText({ allTimeRank, yearRank, year }: TopEffortPlacement) {
  if (!allTimeRank) return `In ${year}`;
  return allTimeRank !== 1 && yearRank ? `All time · #${yearRank} in ${year}` : "All time";
}

/** "PB", "#4": the place the card leads with, all time when it has one. */
function rankBadge({ allTimeRank, yearRank }: TopEffortPlacement) {
  return allTimeRank === 1 ? "PB" : `#${allTimeRank ?? yearRank}`;
}

function cardKey(placement: TopEffortPlacement) {
  return `${placement.boardId}:${placement.activity.id}`;
}

/** Another modal is open; toasts are non-modal dialogs and don't count. */
function otherModalOpen() {
  return document.querySelector(
    '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]:not([aria-modal="false"])',
  );
}

/**
 * Congratulates the athlete on top 10 efforts found by a sync, once, as a deck of cards
 * (ADR 0027). It waits for any other dialog to close first.
 */
export function TopEffortCelebration() {
  const queryClient = useQueryClient();
  const { data } = useQuery(topEffortCelebrationsQueryOptions);
  // What is on screen stays put while a later sync refetches the query underneath.
  const [shown, setShown] = useState<TopEffortCelebrations | null>(null);

  useEffect(() => {
    if (shown || !data?.placements.length) return;
    const show = () => {
      if (otherModalOpen()) return false;
      setShown(data);
      return true;
    };
    if (show()) return;
    const timer = setInterval(() => {
      if (show()) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [data, shown]);

  function dismiss() {
    if (!shown) return;
    const seen = new Set(shown.activityIds);
    queryClient.setQueryData(topEffortCelebrationsQueryOptions.queryKey, (current) =>
      current
        ? {
            activityIds: current.activityIds.filter((id) => !seen.has(id)),
            placements: current.placements.filter((placement) => !seen.has(placement.activity.id)),
          }
        : current,
    );
    setShown(null);
    void markTopEffortsSeen({ data: { activityIds: shown.activityIds } }).finally(() =>
      queryClient.invalidateQueries({ queryKey: topEffortCelebrationsQueryOptions.queryKey }),
    );
  }

  return (
    <ResponsiveDialog
      open={shown != null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {shown ? <CelebrationContent placements={shown.placements} onDone={dismiss} /> : null}
    </ResponsiveDialog>
  );
}

function CelebrationContent({
  placements,
  onDone,
}: {
  placements: TopEffortPlacement[];
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [index, setIndex] = useState(0);
  const count = placements.length;
  const current = placements[index]!;
  const go = (step: number) => setIndex((at) => Math.min(Math.max(at + step, 0), count - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  function openActivity(placement: TopEffortPlacement) {
    onDone();
    void navigate({
      to: "/activities/$activityId",
      params: { activityId: placement.activity.id },
      search: { from: "bests", best: placement.boardId, period: periodOf(placement) },
    });
  }

  function viewBests() {
    onDone();
    void navigate({
      to: "/bests",
      search: { sport: current.sport, best: current.boardId, period: periodOf(current) },
    });
  }

  return (
    <ResponsiveDialogContent className="sm:max-w-sm">
      <ResponsiveDialogHeader className="text-center">
        <ResponsiveDialogTitle className="text-center">
          {count === 1 ? "A top 10 effort" : `${count} top 10 efforts`}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="text-center">
          {count === 1
            ? "Tap the card to open the activity."
            : "Swipe through them. Tap a card to open its activity."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <div className="flex items-center justify-center gap-2 px-4">
        {isDesktop && count > 1 ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            disabled={index === 0}
            onClick={() => go(-1)}
          >
            <ChevronLeftIcon />
          </Button>
        ) : null}
        <Deck placements={placements} index={index} onStep={go} onOpen={openActivity} />
        {isDesktop && count > 1 ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            disabled={index === count - 1}
            onClick={() => go(1)}
          >
            <ChevronRightIcon />
          </Button>
        ) : null}
      </div>

      {count > 1 ? (
        count <= MAX_DOTS ? (
          <div className="flex justify-center gap-1" aria-hidden>
            {placements.map((placement, at) => (
              <span
                key={cardKey(placement)}
                className={cn(
                  "h-1.5 rounded-full transition-all motion-reduce:transition-none",
                  at === index ? "w-4 bg-foreground" : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground tabular-nums">
            {index + 1} / {count}
          </p>
        )
      ) : null}

      <ResponsiveDialogFooter className="flex-row">
        <Button className="flex-1" onClick={viewBests}>
          View bests
        </Button>
        <Button className="flex-1" variant="outline" onClick={onDone}>
          Close
        </Button>
      </ResponsiveDialogFooter>
    </ResponsiveDialogContent>
  );
}

/** A year-only place opens that year on the bests page, so the board shows the ranking. */
function periodOf(placement: TopEffortPlacement) {
  return placement.allTimeRank ? ("all" as const) : (`${placement.year}` as `${number}`);
}

/** Where a card sits relative to the front one: turned away, in front, or fanned behind. */
function stackStyle(offset: number, dragX: number): CSSProperties {
  if (offset < 0) return { transform: "translateX(-130%) rotate(-14deg)", opacity: 0 };
  if (offset === 0) {
    return dragX
      ? { transform: `translateX(${dragX}px) rotate(${dragX / 18}deg)`, transition: "none" }
      : { transform: "none" };
  }
  if (offset === 1) return { transform: "translateX(-16px) rotate(-7deg) scale(0.96)" };
  if (offset === 2) return { transform: "translateX(18px) rotate(8deg) scale(0.92)" };
  return { transform: "scale(0.9)", opacity: 0 };
}

function Deck({
  placements,
  index,
  onStep,
  onOpen,
}: {
  placements: TopEffortPlacement[];
  index: number;
  onStep: (step: number) => void;
  onOpen: (placement: TopEffortPlacement) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const start = useRef<number | null>(null);
  const dragged = useRef(false);
  // Only the opening deal animates; a card coming into view on a swipe just slides into place.
  const [dealing, setDealing] = useState(true);
  useEffect(() => {
    const done = setTimeout(() => setDealing(false), DEAL_MS);
    return () => clearTimeout(done);
  }, []);

  function onPointerDown(event: PointerEvent) {
    start.current = event.clientX;
    dragged.current = false;
  }
  function onPointerMove(event: PointerEvent) {
    if (start.current == null) return;
    const dx = event.clientX - start.current;
    if (!dragged.current && Math.abs(dx) > 6) {
      dragged.current = true;
      // Keeps a mouse drag going after the pointer leaves the card.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragX(dx);
  }
  function onPointerEnd() {
    if (start.current == null) return;
    start.current = null;
    if (dragX <= -SWIPE_PX) onStep(1);
    if (dragX >= SWIPE_PX) onStep(-1);
    setDragX(0);
  }

  return (
    <div
      className="relative h-64 w-44 touch-pan-y select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {placements.map((placement, at) => {
        const offset = at - index;
        // Cards far from the front are neither seen nor animated.
        if (offset < -1 || offset > 3) return null;
        return (
          <div
            key={cardKey(placement)}
            className="absolute inset-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
            style={{
              zIndex: placements.length - at,
              ...stackStyle(offset, offset === 0 ? dragX : 0),
            }}
          >
            <button
              type="button"
              tabIndex={offset === 0 ? 0 : -1}
              aria-hidden={offset !== 0}
              aria-label={`${cardTitle(placement)}, ${rankBadge(placement)}, ${rankText(placement)}. Open ${placement.activity.name}`}
              onClick={() => {
                if (!dragged.current && offset === 0) onOpen(placement);
              }}
              className={cn(
                "size-full",
                dealing &&
                  "animate-[top-effort-deal_0.55s_cubic-bezier(0.2,0.9,0.3,1.15)_both] motion-reduce:animate-none",
              )}
              style={
                dealing ? { animationDelay: `${0.15 + Math.max(2 - at, 0) * 0.12}s` } : undefined
              }
            >
              <EffortCard placement={placement} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EffortCard({ placement }: { placement: TopEffortPlacement }) {
  const medal = placement.allTimeRank ? MEDAL[placement.allTimeRank] : undefined;
  return (
    <div
      className={cn(
        "relative flex size-full flex-col justify-between overflow-hidden rounded-2xl p-4 text-left shadow-lg",
        medal ? "text-[oklch(0.25_0.03_70)]" : "border bg-card text-card-foreground",
      )}
      style={medal}
    >
      {placement.allTimeRank === 1 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1/2 animate-[top-effort-sheen_3s_linear_0.8s_infinite] bg-[conic-gradient(from_0deg,transparent,rgb(255_255_255/0.55),transparent_30%,oklch(0.9_0.12_200/0.35),transparent_60%,oklch(0.9_0.12_330/0.35),transparent)] mix-blend-overlay motion-reduce:animate-none"
        />
      ) : null}
      <div className="relative">
        <p className="text-[0.65rem] font-semibold tracking-widest uppercase opacity-70">
          {cardTitle(placement)}
        </p>
        <p className="mt-1 text-5xl leading-none font-extrabold tracking-tight tabular-nums">
          {rankBadge(placement)}
        </p>
        <p className="mt-1 text-xs font-medium opacity-80">{rankText(placement)}</p>
      </div>
      <div className="relative">
        <p className="text-2xl font-bold tabular-nums">{formatValue(placement, placement.value)}</p>
        <p className="truncate text-[0.65rem] font-semibold tracking-wider uppercase opacity-70">
          {placement.activity.name} · {CARD_DATE.format(new Date(placement.activity.start))}
        </p>
      </div>
    </div>
  );
}
