const PATTERN_ID = "time-out-hatch";

/** A time out band's SVG fill, the stripe of `hatch-time-out` (styles.css). Needs `TimeOutPattern` in the chart. */
export const TIME_OUT_FILL = `url(#${PATTERN_ID})`;

export function TimeOutPattern() {
  return (
    <defs>
      <pattern
        id={PATTERN_ID}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" fill="var(--color-foreground)" fillOpacity="0.04" />
        <rect width="1.5" height="6" fill="var(--color-foreground)" fillOpacity="0.22" />
      </pattern>
    </defs>
  );
}
