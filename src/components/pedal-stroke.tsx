import type { SidePedaling, StrokeAngles } from "@/services/power-file.ts";

const SIZE = 132;
const CENTER = SIZE / 2;
const RADIUS = 46;

/** A crank angle, clockwise from top dead center, as a point on the circle. */
function point(angle: number, radius = RADIUS) {
  const rad = (angle * Math.PI) / 180;
  return [CENTER + radius * Math.sin(rad), CENTER - radius * Math.cos(rad)] as const;
}

function arcPath({ start, arc }: StrokeAngles, radius = RADIUS) {
  const sweep = Math.min(arc, 359.9);
  const [x1, y1] = point(start, radius);
  const [x2, y2] = point(start + sweep, radius);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * One pedal's stroke: the power phase as a wide arc and the peak power phase as a heavy arc on
 * it, with top dead center at 12 o'clock.
 */
export function PedalStroke({
  label,
  side,
  color,
}: {
  label: string;
  side: SidePedaling;
  color: string;
}) {
  const phase = side.phase;
  const peak = side.peak;
  return (
    <figure className="flex min-w-0 flex-col items-center gap-1">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-32 sm:size-36"
        role="img"
        aria-label={
          phase
            ? `${label} power phase from ${phase.start}° to ${phase.end}°${peak ? `, peak from ${peak.start}° to ${peak.end}°` : ""}`
            : `${label}: no power phase recorded`
        }
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={10}
        />
        {[0, 90, 180, 270].map((angle) => {
          const [x1, y1] = point(angle, RADIUS - 9);
          const [x2, y2] = point(angle, RADIUS + 9);
          return (
            <line
              key={angle}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--color-muted-foreground)"
              strokeWidth={1}
            />
          );
        })}
        {phase ? (
          <path
            d={arcPath(phase)}
            fill="none"
            stroke={color}
            strokeOpacity={0.4}
            strokeWidth={10}
          />
        ) : null}
        {peak ? (
          <path
            d={arcPath(peak)}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="butt"
          />
        ) : null}
        <text
          x={CENTER}
          y={CENTER - 4}
          textAnchor="middle"
          className="fill-foreground text-[15px] font-semibold tabular-nums"
        >
          {phase ? `${phase.arc}°` : "—"}
        </text>
        <text
          x={CENTER}
          y={CENTER + 12}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          power phase
        </text>
      </svg>
      <figcaption className="text-center text-xs">
        <span className="font-medium">{label}</span>
        {phase ? (
          <span className="text-muted-foreground block tabular-nums">
            {phase.start}° → {phase.end}°{peak ? ` · peak ${peak.start}° → ${peak.end}°` : ""}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
