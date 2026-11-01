import { useRef, type SyntheticEvent, type TouchEvent } from "react";

/** How far a finger travels before the release changes the week. */
const SWIPE_DISTANCE = 60;
/** Movement before the gesture commits to sideways (week) or vertical (scroll). */
const AXIS_LOCK_DISTANCE = 10;
const SLIDE_MS = 180;
/** Past the current week the list only stretches, so the athlete sees there is nothing newer. */
const EDGE_RESISTANCE = 0.25;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The phone day list follows a sideways swipe and slides to the next or previous training week.
 * Touch events, not pointer events: the browser sends pointercancel once it claims the touch for
 * scrolling the list, but touchend still arrives (as pull-to-refresh relies on).
 */
export function useWeekSwipe({
  onStep,
  canStepForward,
  canStepBack = true,
}: {
  /** Changes the week; resolves once the new week is shown. */
  onStep: (direction: 1 | -1) => Promise<unknown>;
  canStepForward: boolean;
  /** False on the first week there is, which then only stretches like the newest. */
  canStepBack?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ x: number; y: number; dx: number; axis: "x" | "y" | null } | null>(null);
  const sliding = useRef(false);
  const swiped = useRef(false);

  const moveTo = (x: number, ms = 0) => {
    const element = ref.current;
    if (!element) return;
    element.style.transition = ms ? `transform ${ms}ms ease-out` : "none";
    element.style.transform = x ? `translateX(${x}px)` : "";
  };

  /** Slides the shown week off toward the older or newer side and the new one in from the other. */
  const slide = async (direction: 1 | -1) => {
    const width = ref.current?.offsetWidth ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sliding.current = true;
    try {
      if (reduced || !width) {
        moveTo(0);
        await onStep(direction);
        return;
      }
      // Older weeks sit to the left, so going back moves the list right.
      const away = direction === -1 ? width : -width;
      moveTo(away, SLIDE_MS);
      await wait(SLIDE_MS);
      await onStep(direction);
      await nextFrame();
      moveTo(-away);
      await nextFrame();
      moveTo(0, SLIDE_MS);
      await wait(SLIDE_MS);
    } finally {
      sliding.current = false;
    }
  };

  const handlers = {
    onTouchStart: (event: TouchEvent) => {
      swiped.current = false;
      const touch = event.touches[0];
      gesture.current =
        event.touches.length === 1 && !sliding.current
          ? { x: touch.clientX, y: touch.clientY, dx: 0, axis: null }
          : null;
    },
    onTouchMove: (event: TouchEvent) => {
      const current = gesture.current;
      const touch = event.touches[0];
      if (!current || !touch) return;
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (!current.axis && Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_LOCK_DISTANCE) {
        current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (current.axis !== "x") return;
      const blocked = dx < 0 ? !canStepForward : !canStepBack;
      current.dx = blocked ? dx * EDGE_RESISTANCE : dx;
      moveTo(current.dx);
    },
    onTouchEnd: () => {
      const current = gesture.current;
      gesture.current = null;
      if (current?.axis !== "x") return;
      swiped.current = true;
      const direction = current.dx > 0 ? -1 : 1;
      const blocked = direction === 1 ? !canStepForward : !canStepBack;
      if (Math.abs(current.dx) < SWIPE_DISTANCE || blocked) {
        moveTo(0, SLIDE_MS);
        return;
      }
      void slide(direction);
    },
    onTouchCancel: () => {
      gesture.current = null;
      moveTo(0, SLIDE_MS);
    },
    // A swipe can end on the activity it started on; that is not a tap.
    onClickCapture: (event: SyntheticEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return { ref, handlers, slide };
}
