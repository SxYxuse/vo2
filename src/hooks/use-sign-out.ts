import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client.ts";
import { appShellQueryOptions } from "@/lib/queries.ts";

/** Ends the session, drops every cached athlete query, and returns to sign-in. */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await authClient.signOut();
    queryClient.setQueryData(appShellQueryOptions.queryKey, {
      signedIn: false,
      training: null,
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "app-shell",
    });
    await router.invalidate();
    // Unsaved settings edits must not block leaving once the athlete is gone.
    await router.navigate({ to: "/", replace: true, ignoreBlocker: true });
  }, [queryClient, router]);
}
