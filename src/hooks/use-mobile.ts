import { useDesktopMedia } from "@/hooks/use-desktop-media.ts";

export function useIsMobile() {
  const desktop = useDesktopMedia();
  return desktop === null ? false : !desktop;
}
