import { format, isToday } from "date-fns";
import { WifiOffIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";

/**
 * Says the app is offline and how old what it shows is, so a saved week is never read as live
 * (ADR 0031). `updatedAt` is when the app last heard from the server.
 */
export function OfflineBanner({ updatedAt }: { updatedAt: number }) {
  const online = useOnline();
  if (online) return null;
  const when = updatedAt
    ? format(updatedAt, isToday(updatedAt) ? "HH:mm" : "EEE d MMM, HH:mm")
    : null;
  return (
    <div
      role="status"
      className="bg-muted text-muted-foreground flex shrink-0 items-center justify-center gap-2 border-b px-3 py-1.5 text-xs"
    >
      <WifiOffIcon aria-hidden className="size-3.5 shrink-0" />
      <span>{when ? `Offline · as of ${when}` : "Offline · showing what you last loaded"}</span>
    </div>
  );
}
