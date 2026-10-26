"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/responsive-dialog.tsx";
import { boardLabel, formatValue } from "@/components/personal-bests.tsx";
import { Button } from "@/components/ui/button";
import { topEffortCelebrationsQueryOptions } from "@/lib/queries.ts";
import {
  formatBpm,
  formatDistanceKm,
  formatDuration,
  formatElevation,
  formatWatts,
} from "@/services/activity-detail.types.ts";
import { formatLocomotion, locomotionFor } from "@/services/locomotion.ts";
import {
  markTopEffortsSeen,
  type CelebratedActivity,
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
  const [index, setIndex] = useState(0);
  // Opening an activity steps the deck aside; it comes back, on the same card, once the
  // athlete leaves that activity, so the other cards aren't lost.
  const [away, setAway] = useState<{ path: string; arrived: boolean } | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!away) return;
    if (pathname === away.path) {
      if (!away.arrived) setAway({ ...away, arrived: true });
    } else if (away.arrived) {
      setAway(null);
    }
  }, [pathname, away]);

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
            ...current,
            activityIds: current.activityIds.filter((id) => !seen.has(id)),
            placements: current.placements.filter((placement) => !seen.has(placement.activity.id)),
          }
        : current,
    );
    setShown(null);
    setIndex(0);
    setAway(null);
    void markTopEffortsSeen({ data: { activityIds: shown.activityIds } }).finally(() =>
      queryClient.invalidateQueries({ queryKey: topEffortCelebrationsQueryOptions.queryKey }),
    );
  }

  return (
    <ResponsiveDialog
      open={shown != null && away == null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {shown ? (
        <CelebrationContent
          placements={shown.placements}
          activities={shown.activities}
          index={index}
          onIndex={setIndex}
          onAway={(path) => setAway({ path, arrived: false })}
        />
      ) : null}
    </ResponsiveDialog>
  );
}

function CelebrationContent({
  placements,
  activities,
  index,
  onIndex,
  onAway,
}: {
  placements: TopEffortPlacement[];
  activities: TopEffortCelebrations["activities"];
  index: number;
  onIndex: (index: number) => void;
  onAway: (path: string) => void;
}) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [flipped, setFlipped] = useState(false);
  const count = placements.length;
  // Past the last card the deck starts over, and back from the first goes to the last.
  const go = (step: number) => {
    setFlipped(false);
    onIndex((index + step + count) % count);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function openActivity(placement: TopEffortPlacement) {
    onAway(`/activities/${placement.activity.id}`);
    void navigate({
      to: "/activities/$activityId",
      params: { activityId: placement.activity.id },
      search: { from: "bests", best: placement.boardId, period: periodOf(placement) },
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
            ? "Tap the card to turn it over."
            : "Swipe through them. Tap a card to turn it over."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <div className="flex items-center justify-center gap-2 px-4 py-3">
        {isDesktop && count > 1 ? (
          <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => go(-1)}>
            <ChevronLeftIcon />
          </Button>
        ) : null}
        <Deck
          placements={placements}
          activities={activities}
          index={index}
          flipped={flipped}
          onFlip={() => setFlipped((at) => !at)}
          onStep={go}
          onOpen={openActivity}
        />
        {isDesktop && count > 1 ? (
          <Button variant="ghost" size="icon" aria-label="Next" onClick={() => go(1)}>
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
    </ResponsiveDialogContent>
  );
}

/** A year-only place opens that year on the bests page, so the board shows the ranking. */
function periodOf(placement: TopEffortPlacement) {
  return placement.allTimeRank ? ("all" as const) : (`${placement.year}` as `${number}`);
}

/** One side of a card; it turns invisible when the card is edge-on, half way into the turn. */
const FACE =
  "absolute inset-0 backface-hidden transition-[visibility] delay-250 duration-0 motion-reduce:delay-0";

/** Where a card sits relative to the front one: turned away, in front, or fanned behind. */
function stackStyle(offset: number, dragX: number): CSSProperties {
  if (offset === -1) return { transform: "translateX(-130%) rotate(-14deg)", opacity: 0 };
  if (offset === 0) {
    return dragX
      ? { transform: `translateX(${dragX}px) rotate(${dragX / 18}deg)`, transition: "none" }
      : { transform: "none" };
  }
  if (offset === 1) return { transform: "translateX(-16px) rotate(-7deg) scale(0.96)" };
  if (offset === 2) return { transform: "translateX(18px) rotate(8deg) scale(0.92)" };
  return { transform: "scale(0.9)", opacity: 0 };
}

/**
 * A card's place in the deck going round: 0 in front, 1 and 2 fanned behind, -1 the card just
 * turned away. With three cards or fewer every other card is behind, so none is turned away.
 */
function deckOffset(at: number, index: number, count: number) {
  const behind = (at - index + count) % count;
  return count > 3 && behind === count - 1 ? -1 : behind;
}

function Deck({
  placements,
  activities,
  index,
  flipped,
  onFlip,
  onStep,
  onOpen,
}: {
  placements: TopEffortPlacement[];
  activities: TopEffortCelebrations["activities"];
  index: number;
  flipped: boolean;
  onFlip: () => void;
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
        const offset = deckOffset(at, index, placements.length);
        // Cards far from the front are neither seen nor animated.
        if (offset > 3) return null;
        const front = offset === 0;
        const turned = front && flipped;
        const flip = () => {
          if (!dragged.current) onFlip();
        };
        return (
          <div
            key={cardKey(placement)}
            inert={!front}
            className="absolute inset-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
            style={{
              // The card turned away stays on top, so it leaves over the deck, not under it.
              zIndex: offset === -1 ? placements.length + 1 : placements.length - offset,
              ...stackStyle(offset, front ? dragX : 0),
            }}
          >
            <div
              className={cn(
                "size-full perspective-[800px]",
                dealing &&
                  "animate-[top-effort-deal_0.55s_cubic-bezier(0.2,0.9,0.3,1.15)_both] motion-reduce:animate-none",
              )}
              style={
                dealing ? { animationDelay: `${0.15 + Math.max(2 - at, 0) * 0.12}s` } : undefined
              }
            >
              {/*
               * The face turned away is hidden outright, not only by backface culling: the frame a
               * transition ends on can drop the culling (WebKit, and the sheen's own layer) and
               * flash the front. The swap waits for the card to be edge-on, half way through the
               * symmetric ease-in-out turn.
               */}
              <div
                className={cn(
                  "relative size-full transition-transform duration-500 ease-in-out transform-3d motion-reduce:transition-none",
                  turned && "rotate-y-180",
                )}
              >
                <button
                  type="button"
                  inert={turned}
                  aria-label={`${cardTitle(placement)}, ${rankBadge(placement)}, ${rankText(placement)}. Turn over`}
                  onClick={flip}
                  className={cn(FACE, turned && "invisible")}
                >
                  <EffortCard placement={placement} />
                </button>
                <div inert={!turned} className={cn(FACE, "rotate-y-180", !turned && "invisible")}>
                  <EffortCardBack
                    placement={placement}
                    summary={activities[placement.activity.id]}
                    onFlip={flip}
                    onOpen={onOpen}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function medalOf(placement: TopEffortPlacement) {
  return placement.allTimeRank ? MEDAL[placement.allTimeRank] : undefined;
}

function cardFace(medal: CSSProperties | undefined) {
  return cn(
    "relative flex size-full flex-col justify-between overflow-hidden rounded-2xl p-4 text-left shadow-lg",
    medal ? "text-[oklch(0.25_0.03_70)]" : "border bg-card text-card-foreground",
  );
}

function EffortCard({ placement }: { placement: TopEffortPlacement }) {
  const medal = medalOf(placement);
  return (
    <div className={cardFace(medal)} style={medal}>
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

/** The activity's own numbers, the whole of it rather than the effort. */
function activityStats(sportType: string, summary: CelebratedActivity) {
  const { distance, movingTime } = summary;
  const kmh = distance && movingTime ? (distance / movingTime) * 3.6 : null;
  const stats: [string, string][] = [
    ["Distance", formatDistanceKm(distance)],
    ["Moving time", formatDuration(movingTime)],
    [locomotionFor(sportType).kpiLabel, formatLocomotion(kmh, sportType)],
  ];
  if (summary.totalElevationGain) {
    stats.push(["Elevation", formatElevation(summary.totalElevationGain)]);
  }
  if (summary.averageHeartrate) stats.push(["Avg HR", formatBpm(summary.averageHeartrate)]);
  if (summary.averageWatts) stats.push(["Avg power", formatWatts(summary.averageWatts)]);
  return stats;
}

function EffortCardBack({
  placement,
  summary,
  onFlip,
  onOpen,
}: {
  placement: TopEffortPlacement;
  summary: CelebratedActivity | undefined;
  onFlip: () => void;
  onOpen: (placement: TopEffortPlacement) => void;
}) {
  const medal = medalOf(placement);
  const { activity } = placement;
  return (
    <div className={cardFace(medal)} style={medal}>
      {/* Tapping anywhere but the button turns the card back. */}
      <button type="button" aria-label="Turn back" onClick={onFlip} className="absolute inset-0" />
      <div className="pointer-events-none relative">
        <p className="text-[0.65rem] font-semibold tracking-widest uppercase opacity-70">
          {CARD_DATE.format(new Date(activity.start))}
        </p>
        <p className="mt-1 line-clamp-2 text-sm leading-snug font-bold">{activity.name}</p>
        {summary ? (
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs">
            {activityStats(activity.sportType, summary).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="opacity-70">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <Button size="sm" className="relative w-full" onClick={() => onOpen(placement)}>
        Open activity
      </Button>
    </div>
  );
}
