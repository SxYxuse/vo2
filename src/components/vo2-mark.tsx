import { APP_NAME } from "#/lib/brand.ts";
import { cn } from "#/lib/utils.ts";

type Vo2MarkProps = {
  className?: string;
};

/** App icon: VO₂ lab formula on the dark tile. */
export function Vo2Mark({ className }: Vo2MarkProps) {
  return (
    <img
      src="/icon-192.png"
      alt=""
      width={16}
      height={16}
      className={cn("size-4 shrink-0 rounded-[5px]", className)}
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
        <span className="relative top-[0.32em] -ml-px text-[0.62em] font-semibold text-ds-blue-700">
          2
        </span>
      </span>
    </span>
  );
}
