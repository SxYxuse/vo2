import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, Settings2Icon } from "lucide-react";

import { PageHeader } from "@/components/page-header.tsx";
import { settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  showsSettingsSection,
} from "@/lib/settings-sections.ts";

/** Every settings section as a list, so a phone, which has no settings sidebar, can reach each. */
export function SettingsIndex() {
  const { data } = useSuspenseQuery(settingsSnapshotQueryOptions);
  const sections = SETTINGS_SECTIONS.filter((item) =>
    showsSettingsSection(item.id, data.settings.sportTypes),
  );
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <PageHeader icon={Settings2Icon} title="Settings" />
      {SETTINGS_GROUPS.map((group) => (
        <section
          key={group.id}
          aria-labelledby={`settings-group-${group.id}`}
          className="flex flex-col gap-1.5"
        >
          <h2
            id={`settings-group-${group.id}`}
            className="text-muted-foreground px-1 text-xs font-medium"
          >
            {group.label}
          </h2>
          <ul className="bg-card ring-foreground/10 divide-y overflow-hidden rounded-lg ring-1">
            {sections
              .filter((item) => item.group === group.id)
              .map((item) => (
                <li key={item.id}>
                  <Link
                    to="/settings/$section"
                    params={{ section: item.id }}
                    className="hover:bg-muted/50 focus-visible:bg-muted/50 flex min-h-[2.75rem] items-center gap-3 px-3 py-2.5 text-sm outline-none"
                  >
                    <item.icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRightIcon aria-hidden className="text-muted-foreground size-4" />
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
