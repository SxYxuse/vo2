import { useCallback, useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

const THEME_CYCLE = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

/**
 * Current theme plus the one a tap switches to, cycling Light → Dark → System.
 * `mounted` stays false until hydration, since the stored theme is unknown on the server.
 */
export function useThemeCycle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = THEME_CYCLE.find((option) => option.value === theme) ?? THEME_CYCLE[2];
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  const cycle = useCallback(() => setTheme(next.value), [setTheme, next.value]);

  return { mounted, current, next, cycle };
}
