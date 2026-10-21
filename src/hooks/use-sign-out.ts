import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client.ts";
import { afterSignOut } from "@/lib/query-events.ts";

/**
 * Ends the session, drops every cached athlete query, and returns to sign-in.
 * Pass ignoreBlocker once the athlete is gone, so unsaved settings edits cannot hold them on a dead page.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(
    async ({ ignoreBlocker = false }: { ignoreBlocker?: boolean } = {}) => {
      // Offline or an already-deleted session must not strand the athlete here.
      await authClient.signOut().catch(() => undefined);
      afterSignOut(queryClient);
      await router.invalidate();
      await router.navigate({ to: "/", replace: true, ignoreBlocker });
    },
    [queryClient, router],
  );
}
