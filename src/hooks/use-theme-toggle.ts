import { useCallback, useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

const THEMES = {
  light: { value: "light", label: "Light", icon: SunIcon },
  dark: { value: "dark", label: "Dark", icon: MoonIcon },
} as const;

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
