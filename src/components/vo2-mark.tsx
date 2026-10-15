import { APP_NAME } from "#/lib/brand.ts";
import { cn } from "#/lib/utils.ts";

type Vo2MarkProps = {
  className?: string;
};

/** App icon tile. Use only in collapsed chrome; the wordmark is the expanded brand. */
export function Vo2Mark({ className }: Vo2MarkProps) {
  return (
    <img
      src="/icon-192.png"
      alt=""
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-md", className)}
    />
  );
}

/** In-app wordmark: VO with a blue subscript 2. */
export function Vo2Wordmark({ className }: Vo2MarkProps) {
  return (
    <span className={cn("inline-flex items-baseline tracking-tight", className)}>
      <span className="sr-only">{APP_NAME}</span>
      <span aria-hidden="true">
        VO
        <span className="relative top-[0.28em] -ml-px text-[0.7em] font-semibold text-ds-blue-700">
          2
        </span>
      </span>
    </span>
  );
}
