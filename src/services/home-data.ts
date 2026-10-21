import { createServerFn } from "@tanstack/react-start";

import type { HomeData } from "./home-data.types.ts";

export const loadHomeData = createServerFn({ method: "GET" }).handler(
  async (): Promise<HomeData> => {
    const { loadHomeDataImpl } = await import("./home-data.server.ts");
    return loadHomeDataImpl();
  },
);
