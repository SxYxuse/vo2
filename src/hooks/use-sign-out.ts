import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client.ts";
import { removeCoachChats } from "@/lib/coach-storage.ts";
import { removeGpxMergeDraft } from "@/lib/gpx-merge-draft.ts";
import { afterSignOut } from "@/lib/query-events.ts";
import { removeSavedPages } from "@/lib/service-worker.ts";
import { removeOfflineCopy } from "@/integrations/tanstack-query/offline-copy.ts";

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(
    async ({ ignoreBlocker = false }: { ignoreBlocker?: boolean } = {}) => {
      await authClient.signOut().catch(() => undefined);
      afterSignOut(queryClient);
      await Promise.all([
        removeOfflineCopy(),
        removeSavedPages(),
        removeCoachChats(),
        removeGpxMergeDraft(),
      ]);
      await router.invalidate();
      await router.navigate({ to: "/sign-in", replace: true, ignoreBlocker });
    },
    [queryClient, router],
  );
}
