"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  VISUAL_HEIGHT_MESSAGE,
  VISUAL_THEME_VARIABLES,
  visualDocument,
} from "@/services/coach-visual.ts";

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 1600;

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}

/** The app's colour scheme and theme variables, read again whenever the theme class flips. */
function readTheme() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return JSON.stringify({
    scheme: root.classList.contains("dark") ? "dark" : "light",
    variables: Object.fromEntries(
      VISUAL_THEME_VARIABLES.map((name) => [name, style.getPropertyValue(name).trim()]),
    ),
  });
}

/**
 * A visual the coach wrote, in a sandboxed frame with no network and no access to the app
 * (ADR 0035). The frame reports its height so it never scrolls inside the chat.
 */
export function CoachVisual({ title, html }: { title: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  // A string snapshot, so React sees no change until the theme really does change.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "");
  const { scheme, variables } = JSON.parse(theme || '{"scheme":"light","variables":{}}') as {
    scheme: "light" | "dark";
    variables: Record<string, string>;
  };
  const srcDoc = visualDocument(html, variables, scheme);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type !== VISUAL_HEIGHT_MESSAGE || typeof data.height !== "number") return;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <figure className="flex w-full min-w-0 flex-col gap-1.5">
      <iframe
        ref={frame}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="w-full border-0 bg-transparent"
        // A frame whose color scheme differs from its page gets an opaque backdrop.
        style={{ height, colorScheme: scheme }}
      />
      <figcaption className="text-muted-foreground text-xs">{title}</figcaption>
    </figure>
  );
}
