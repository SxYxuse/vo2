import { useCallback, useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

const THEMES = {
  light: { value: "light", label: "Light", icon: SunIcon },
  dark: { value: "dark", label: "Dark", icon: MoonIcon },
} as const;

/**
 * Light/dark toggle that starts from the device preference.
 * Until the athlete taps it, the theme follows the device; a tap pins the opposite of what is showing.
 * `mounted` stays false until hydration, since the stored theme is unknown on the server.
 */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = resolvedTheme === "light" ? THEMES.light : THEMES.dark;
  const next = current === THEMES.dark ? THEMES.light : THEMES.dark;
  const toggle = useCallback(() => setTheme(next.value), [setTheme, next.value]);

  return { mounted, current, next, toggle };
}
