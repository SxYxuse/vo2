import { createFileRoute, redirect } from "@tanstack/react-router";

import { isSettingsSection } from "@/lib/settings-sections.ts";

// The settings layout owns the form so unsaved edits survive switching sections.
export const Route = createFileRoute("/_app/settings/$section")({
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section)) {
      throw redirect({ to: "/settings/$section", params: { section: "profile" }, replace: true });
    }
  },
});
