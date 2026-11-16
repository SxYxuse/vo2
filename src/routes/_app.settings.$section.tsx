import { createFileRoute, redirect } from "@tanstack/react-router";

import { isSettingsSection } from "@/lib/settings-sections.ts";

export const Route = createFileRoute("/_app/settings/$section")({
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section)) {
      throw redirect({ to: "/settings/$section", params: { section: "profile" }, replace: true });
    }
  },
});
