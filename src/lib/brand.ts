/** User-facing product name. Local DB/auth identifiers stay `vo` so existing setups keep working. */
export const APP_NAME = "VO2";

const PRODUCTION_THEME_COLOR = "#171717";
const STAGING_THEME_COLOR = "#c2410c";

export type AppChrome = {
  themeColor: string;
  manifest: string;
  icon32: string;
  icon192: string;
  appleTouch: string;
};

/** Tab/PWA chrome. Staging uses an orange tile so it cannot be mistaken for production. */
export function appChrome(appEnv: string): AppChrome {
  if (appEnv === "staging") {
    return {
      themeColor: STAGING_THEME_COLOR,
      manifest: "/staging/manifest.webmanifest",
      icon32: "/staging/icon-32.png",
      icon192: "/staging/icon-192.png",
      appleTouch: "/staging/apple-touch-icon.png",
    };
  }
  return {
    themeColor: PRODUCTION_THEME_COLOR,
    manifest: "/manifest.webmanifest",
    icon32: "/icon-32.png",
    icon192: "/icon-192.png",
    appleTouch: "/apple-touch-icon.png",
  };
}
