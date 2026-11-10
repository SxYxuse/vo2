import { createFileRoute } from "@tanstack/react-router";

import { SettingsIndex } from "@/components/settings-index.tsx";

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsIndex,
});
