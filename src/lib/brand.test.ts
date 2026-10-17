import { describe, expect, it } from "vite-plus/test";

import { appChrome } from "./brand.ts";

describe("appChrome", () => {
  it("uses the orange tile when APP_ENV is staging", () => {
    expect(appChrome("staging")).toEqual({
      themeColor: "#c2410c",
      manifest: "/staging/manifest.webmanifest",
      icon32: "/staging/icon-32.png",
      icon192: "/staging/icon-192.png",
      appleTouch: "/staging/apple-touch-icon.png",
    });
  });

  it("keeps the dark tile for production and local environments", () => {
    for (const appEnv of ["production", "development", "test"]) {
      expect(appChrome(appEnv)).toEqual({
        themeColor: "#171717",
        manifest: "/manifest.webmanifest",
        icon32: "/icon-32.png",
        icon192: "/icon-192.png",
        appleTouch: "/apple-touch-icon.png",
      });
    }
  });
});
