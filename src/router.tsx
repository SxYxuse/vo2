import {
  createRouter as createTanStackRouter,
  parseSearchWith,
  stringifySearchWith,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./integrations/tanstack-query/root-provider";

function parseSearchValue(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function getRouter() {
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    defaultPreloadStaleTime: 0,
    parseSearch: parseSearchWith(parseSearchValue),
    stringifySearch: stringifySearchWith((value) => {
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    }, parseSearchValue),
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

declare module "@tanstack/history" {
  interface HistoryState {
    /** Set on the entry pushed by tapping the activity map, so closing it can pop that entry. */
    activityMapPushed?: true;
    /** Set on a coach-plan session opened from the plan, so its "This week" can go back. */
    planSessionPushed?: true;
  }
}
