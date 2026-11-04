"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, UploadIcon, ZapIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { formatDistanceKm, formatDuration, formatWatts } from "@/services/activity-detail.ts";
import {
  importPowerFile,
  powerFileTitle,
  type PowerFileImport,
  type PowerFileListItem,
} from "@/services/power-file.ts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

const WHERE_FROM =
  "On Garmin Connect, open a ride, then ⚙ → Export Original. Import the .zip as it is, or the .fit inside it.";

const RIDE_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "L 52 / R 48" from the right pedal's share. */
export function formatBalance(rightPct: number | null) {
  if (rightPct == null) return "—";
  const right = Math.round(rightPct);
  return `L ${100 - right} / R ${right}`;
}

/**
 * Picks FIT files and imports them one at a time. A single file opens its analysis; a file
 * imported before opens that import.
 */
export function ImportPowerFileButton({ className }: { className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const online = useOnline();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function importFiles(files: File[]) {
    if (!files.length) return;
    const results: PowerFileImport[] = [];
    for (const [index, file] of files.entries()) {
      setProgress({ done: index, total: files.length });
      const form = new FormData();
      form.set("file", file);
      try {
        const result = await importPowerFile({ data: form });
        results.push(result);
        if (result.status === "rejected") {
          toast.add({
            type: "error",
            title: `Could not import ${file.name}`,
            description: result.reason,
          });
        }
      } catch {
        toast.add({
          type: "error",
          title: `Could not import ${file.name}`,
          description: "Nothing was saved. Check your connection and try again.",
        });
      }
    }
    setProgress(null);
    const saved = results.filter((result) => result.status !== "rejected");
    if (!saved.length) return;
    await queryClient.invalidateQueries({ queryKey: ["power-files"] });
    // The ride's activity page links to its power file.
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    if (files.length === 1) {
      void navigate({ to: "/power/$fileId", params: { fileId: saved[0].id } });
      return;
    }
    const added = results.filter((result) => result.status === "imported").length;
    toast.add({
      type: "success",
      title: added === 1 ? "1 ride imported" : `${added} rides imported`,
      description:
        saved.length > added ? `${saved.length - added} were imported before.` : undefined,
    });
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        // No `accept`: iOS greys out .fit files it has no type for, so the server checks instead.
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void importFiles(files);
        }}
      />
      <Button
        className={className}
        disabled={!online || progress != null}
        onClick={() => input.current?.click()}
      >
        {progress ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
        {progress
          ? progress.total > 1
            ? `Importing ${progress.done + 1} of ${progress.total}`
            : "Importing"
          : "Import FIT file"}
      </Button>
    </>
  );
}

function PowerFileRow({ file }: { file: PowerFileListItem }) {
  const facts = [
    formatDistanceKm(file.distanceM),
    formatDuration(file.movingSec),
    file.normalizedWatts ? `NP ${formatWatts(file.normalizedWatts)}` : formatWatts(file.avgWatts),
    file.rightPct == null ? null : formatBalance(file.rightPct),
  ].filter(Boolean);
  return (
    <Item
      variant="outline"
      className="min-h-14"
      render={<Link to="/power/$fileId" params={{ fileId: file.id }} />}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full truncate text-sm">{powerFileTitle(file)}</ItemTitle>
        <ItemDescription>
          {RIDE_DATE.format(new Date(file.start))}
          <br />
          <span className="tabular-nums">{facts.join(" · ")}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <ChevronRightIcon aria-hidden className="text-muted-foreground size-4" />
      </ItemActions>
    </Item>
  );
}

export function PowerFilesView({ files }: { files: PowerFileListItem[] }) {
  if (!files.length) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ZapIcon />
          </EmptyMedia>
          <EmptyTitle>No power files yet</EmptyTitle>
          <EmptyDescription>{WHERE_FROM}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <ImportPowerFileButton />
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ItemGroup className="gap-2">
        {files.map((file) => (
          <PowerFileRow key={file.id} file={file} />
        ))}
      </ItemGroup>
      <p className="text-muted-foreground text-xs">{WHERE_FROM}</p>
    </div>
  );
}
