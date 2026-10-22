import { describe, expect, it } from "vite-plus/test";

import { appChrome } from "./brand.ts";

describe("appChrome", () => {
  it.each([
    ["development", "#525252"],
    ["staging", "#c2410c"],
    ["preview", "#1d4ed8"],
  ])("gives %s its own tile", (appEnv, themeColor) => {
    expect(appChrome(appEnv)).toEqual({
      themeColor,
      manifest: `/${appEnv}/manifest.webmanifest`,
      icon32: `/${appEnv}/icon-32.png`,
      icon192: `/${appEnv}/icon-192.png`,
      appleTouch: `/${appEnv}/apple-touch-icon.png`,
    });
  });

  it("keeps the dark tile for production and unknown environments", () => {
    for (const appEnv of ["production", "test"]) {
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
