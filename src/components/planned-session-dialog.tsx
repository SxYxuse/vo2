"use client";

import { useRef } from "react";
import { format, parseISO } from "date-fns";
import { BikeIcon, FootprintsIcon } from "lucide-react";

import { formatHours, type PlannedSession } from "#/services/training-plan.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "#/components/responsive-dialog.tsx";

function statusLabel(status: PlannedSession["status"]) {
  if (status === "adapted") return "Updated plan";
  if (status === "done") return "Done";
  return "Suggested";
}

function statusVariant(status: PlannedSession["status"]) {
  if (status === "adapted") return "info" as const;
  if (status === "done") return "success" as const;
  return "outline" as const;
}

function sportLabel(family: PlannedSession["sportFamily"]) {
  return family === "running" ? "Run" : "Ride";
}

export function PlannedSessionDialog({
  session,
  onOpenChange,
}: {
  session: PlannedSession | null;
  onOpenChange: (open: boolean) => void;
}) {
  const lastSession = useRef(session);
  if (session) lastSession.current = session;
  const shown = session ?? lastSession.current;
  const dateLabel = shown
    ? `This week · ${format(parseISO(`${shown.weekStart}T12:00:00`), "MMM d")} start`
    : "";
  const SportIcon = shown?.sportFamily === "cycling" ? BikeIcon : FootprintsIcon;

  return (
    <ResponsiveDialog open={Boolean(session)} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <ResponsiveDialogHeader className="border-b px-4 py-3 pe-12 group-data-[swipe-axis=y]/drawer-popup:text-left">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ResponsiveDialogTitle className="min-w-0 truncate">
              {shown?.title ?? "Suggested session"}
            </ResponsiveDialogTitle>
            <Badge variant={shown ? statusVariant(shown.status) : "outline"}>
              {shown ? statusLabel(shown.status) : "Suggested"}
            </Badge>
          </div>
          <ResponsiveDialogDescription>
            {shown?.status === "done" && shown.activityTitle
              ? `Logged as ${shown.activityTitle} on ${format(parseISO(`${shown.date}T12:00:00`), "MMM d")}.`
              : dateLabel
                ? `${dateLabel}. Not logged yet — pick any day that fits.`
                : "Planned workout"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {shown ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Card size="sm" className="gap-1 py-3">
                  <CardHeader className="px-3">
                    <CardDescription>Duration</CardDescription>
                    <CardTitle className="font-mono text-base tabular-nums">
                      {formatHours(shown.targetMinutes / 60)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card size="sm" className="gap-1 py-3">
                  <CardHeader className="px-3">
                    <CardDescription>Target load</CardDescription>
                    <CardTitle className="font-mono text-base tabular-nums">
                      {Math.round(shown.targetLoad)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card size="sm" className="col-span-2 gap-1 py-3">
                  <CardHeader className="px-3">
                    <CardDescription>Sport</CardDescription>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <SportIcon
                        className={
                          shown.sportFamily === "cycling" ? "text-ds-blue-700" : "text-ds-amber-700"
                        }
                      />
                      {sportLabel(shown.sportFamily)}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>
              {shown.note ? <p className="text-muted-foreground text-sm">{shown.note}</p> : null}
            </div>
          </div>
        ) : null}
        <ResponsiveDialogFooter className="border-t px-4 py-3">
          <ResponsiveDialogClose render={<Button type="button" variant="outline" />}>
            Close
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
