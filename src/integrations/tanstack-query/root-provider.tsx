import { MutationCache, QueryClient } from "@tanstack/react-query";

import { toast } from "@/components/ui/toast";
import { keepOfflineCopy } from "./offline-copy.ts";

export function getContext() {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onError: () => {
        if (navigator.onLine) return;
        toast.add({
          type: "error",
          title: "You're offline",
          description: "Nothing was saved. Reconnect, then try again.",
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        retry: 1,
      },
      // Offline is read-only (ADR 0031): fail at once rather than pause and send it later.
      mutations: { networkMode: "always" },
    },
  });

  return {
    queryClient,
    /** Resolves once the views saved on this device are back in the cache; at once on the server. */
    offlineCopyRestored:
      typeof window === "undefined" ? Promise.resolve() : keepOfflineCopy(queryClient),
  };
}
