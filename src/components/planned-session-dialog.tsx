"use client";

import { format, parseISO } from "date-fns";
import { BikeIcon, FootprintsIcon } from "lucide-react";

import {
  formatHours,
  type PlannedSession,
} from "#/services/training-plan.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const dateLabel = session
    ? `This week · ${format(parseISO(`${session.weekStart}T12:00:00`), "MMM d")} start`
    : "";
  const SportIcon = session?.sportFamily === "cycling" ? BikeIcon : FootprintsIcon;

  return (
    <Dialog open={Boolean(session)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3 pe-12">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DialogTitle className="min-w-0 truncate">{session?.title ?? "Suggested session"}</DialogTitle>
            <Badge variant={session ? statusVariant(session.status) : "outline"}>
              {session ? statusLabel(session.status) : "Suggested"}
            </Badge>
          </div>
          <DialogDescription>
            {session?.status === "done" && session.activityTitle
              ? `Logged as ${session.activityTitle} on ${format(parseISO(`${session.date}T12:00:00`), "MMM d")}.`
              : dateLabel
                ? `${dateLabel}. Not logged yet — pick any day that fits.`
                : "Planned workout"}
          </DialogDescription>
        </DialogHeader>
        {session ? (
          <div className="flex flex-col gap-3 overflow-auto p-4">
            <div className="grid grid-cols-2 gap-2">
              <Card size="sm" className="gap-1 py-3">
                <CardHeader className="px-3">
                  <CardDescription>Duration</CardDescription>
                  <CardTitle className="font-mono text-base tabular-nums">
                    {formatHours(session.targetMinutes / 60)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm" className="gap-1 py-3">
                <CardHeader className="px-3">
                  <CardDescription>Target load</CardDescription>
                  <CardTitle className="font-mono text-base tabular-nums">
                    {Math.round(session.targetLoad)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm" className="col-span-2 gap-1 py-3">
                <CardHeader className="px-3">
                  <CardDescription>Sport</CardDescription>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <SportIcon
                      className={
                        session.sportFamily === "cycling"
                          ? "text-ds-blue-700"
                          : "text-ds-amber-700"
                      }
                    />
                    {sportLabel(session.sportFamily)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>
            {session.note ? (
              <p className="text-muted-foreground text-sm">{session.note}</p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter className="border-t px-4 py-3">
          <DialogClose render={<Button type="button" variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
