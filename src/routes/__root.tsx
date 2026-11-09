import { useEffect, type ReactNode } from "react";
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { PullToRefresh } from "@/components/pull-to-refresh.tsx";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { loadAppEnv } from "@/lib/app-env.ts";
import { registerServiceWorker } from "@/lib/service-worker.ts";
import { APP_NAME, appChrome } from "@/lib/brand.ts";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
  offlineCopyRestored: Promise<void>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  loader: () => loadAppEnv(),
  // The environment never changes while the app runs; reloading it on navigation fails offline.
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData }) => {
    const chrome = appChrome(loaderData?.appEnv ?? "development");
    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { title: APP_NAME },
        {
          name: "description",
          content: `${APP_NAME} copies your Strava activities, scores fitness and form, and plans each training week toward your goals.`,
        },
        { name: "theme-color", content: chrome.themeColor },
        { name: "apple-mobile-web-app-title", content: APP_NAME },
        { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "manifest", href: chrome.manifest },
        { rel: "icon", href: chrome.icon32, type: "image/png", sizes: "32x32" },
        { rel: "icon", href: chrome.icon192, type: "image/png", sizes: "192x192" },
        { rel: "apple-touch-icon", href: chrome.appleTouch },
      ],
    };
  },
  shellComponent: RootDocument,
});

/**
 * The devtools button sits over the composer's Send on phones, in every screenshot and recording,
 * so it shows only when asked for (.env.example).
 */
const SHOW_DEVTOOLS = import.meta.env.DEV && import.meta.env.VITE_DEVTOOLS === "1";

function RootDocument({ children }: { children: ReactNode }) {
  useEffect(registerServiceWorker, []);
  // Clicks before hydration do nothing, so scripts and e2e wait for this instead of guessing.
  useEffect(() => {
    document.body.dataset.hydrated = "";
  }, []);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            {SHOW_DEVTOOLS ? (
              <TanStackDevtools
                config={{
                  position: "bottom-right",
                }}
                plugins={[
                  {
                    name: "Tanstack Router",
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                  TanStackQueryDevtools,
                ]}
              />
            ) : null}
            <Toaster />
            <PullToRefresh />
          </TooltipProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
