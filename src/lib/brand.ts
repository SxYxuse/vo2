/** User-facing product name. Local DB/auth identifiers stay `vo` so existing setups keep working. */
export const APP_NAME = "VO2";

export type AppChrome = {
  themeColor: string;
  manifest: string;
  icon32: string;
  icon192: string;
  appleTouch: string;
};

function chromeFor(themeColor: string, dir: string): AppChrome {
  return {
    themeColor,
    manifest: `${dir}/manifest.webmanifest`,
    icon32: `${dir}/icon-32.png`,
    icon192: `${dir}/icon-192.png`,
    appleTouch: `${dir}/apple-touch-icon.png`,
  };
}

const PRODUCTION_CHROME = chromeFor("#171717", "");

/**
 * Tab/PWA chrome per APP_ENV, so an installed non-production app cannot be mistaken for
 * production: grey for development, orange for staging, blue for PR previews.
 */
const CHROME_BY_ENV: Record<string, AppChrome> = {
  development: chromeFor("#525252", "/development"),
  staging: chromeFor("#c2410c", "/staging"),
  preview: chromeFor("#1d4ed8", "/preview"),
};

export function appChrome(appEnv: string): AppChrome {
  return CHROME_BY_ENV[appEnv] ?? PRODUCTION_CHROME;
}
