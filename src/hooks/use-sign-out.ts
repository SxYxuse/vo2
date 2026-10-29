import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client.ts";
import { removeCoachChats } from "@/lib/coach-storage.ts";
import { afterSignOut } from "@/lib/query-events.ts";
import { removeSavedPages } from "@/lib/service-worker.ts";
import { removeOfflineCopy } from "@/integrations/tanstack-query/offline-copy.ts";

/**
 * Ends the session, drops every cached athlete query, the copy saved on the device for
 * offline, and the coach chat, and returns to sign-in.
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
      await Promise.all([removeOfflineCopy(), removeSavedPages(), removeCoachChats()]);
      await router.invalidate();
      await router.navigate({ to: "/", replace: true, ignoreBlocker });
    },
    [queryClient, router],
  );
}
