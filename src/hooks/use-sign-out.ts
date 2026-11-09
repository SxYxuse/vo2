import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client.ts";
import { removeCoachChats } from "@/lib/coach-storage.ts";
import { removeGpxMergeDraft } from "@/lib/gpx-merge-draft.ts";
import { removeRouteBuilderDraft } from "@/lib/route-builder-draft.ts";
import { afterSignOut } from "@/lib/query-events.ts";
import { removeSavedPages } from "@/lib/service-worker.ts";
import { removeOfflineCopy } from "@/integrations/tanstack-query/offline-copy.ts";

/**
 * Ends the session, drops every cached athlete query, the copy saved on the device for
 * offline, the coach chat, any GPX merge in progress, and the route builder's zone and routes,
 * and returns to sign-in.
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
      await Promise.all([
        removeOfflineCopy(),
        removeSavedPages(),
        removeCoachChats(),
        removeGpxMergeDraft(),
        removeRouteBuilderDraft(),
      ]);
      await router.invalidate();
      await router.navigate({ to: "/sign-in", replace: true, ignoreBlocker });
    },
    [queryClient, router],
  );
}
