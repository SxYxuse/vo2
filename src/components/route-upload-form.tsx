"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";

import { routePlansQueryOptions } from "@/lib/queries.ts";
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { DEFAULT_BOTTLES, DEFAULT_CARB_TARGET, MAX_CARBS_PER_HOUR } from "@/services/fuel-plan.ts";
import { MAX_GPX_BYTES } from "@/services/route-gpx.ts";
import { routeSportGroup } from "@/services/route-prediction.ts";
import { createRoutePlan, ROUTE_SPORT_TYPES, type RouteDefaults } from "@/services/route-plan.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { BottleFields } from "@/components/route-bottle-fields.tsx";

type RouteSportType = (typeof ROUTE_SPORT_TYPES)[number];

function settingsFor(sportType: RouteSportType, defaults: RouteDefaults) {
  const group = routeSportGroup(sportType) ?? "cycling";
  const last = defaults[group];
  return {
    carbTarget: String(last?.carbTarget ?? DEFAULT_CARB_TARGET[group]),
    bottleCount: last?.bottleCount ?? DEFAULT_BOTTLES[group].count,
    bottleMl: last?.bottleMl ?? DEFAULT_BOTTLES[group].ml,
    mixBottleCount: last?.mixBottleCount ?? null,
  };
}

export function RouteUploadForm({
  defaults,
  defaultSportType,
}: {
  defaults: RouteDefaults;
  defaultSportType: RouteSportType;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sportType, setSportType] = useState<RouteSportType>(defaultSportType);
  const [settings, setSettings] = useState(() => settingsFor(defaultSportType, defaults));
  const [fileError, setFileError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a GPX file.");
      const gpx = await file.text();
      return createRoutePlan({
        data: {
          gpx,
          sportType,
          carbTarget: Number(settings.carbTarget),
          bottleCount: settings.bottleCount,
          bottleMl: settings.bottleMl,
          mixBottleCount: settings.mixBottleCount,
        },
      });
    },
    onSuccess: async ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: routePlansQueryOptions.queryKey });
      await navigate({ to: "/fuel/$planId", params: { planId: id } });
    },
  });

  const carbTarget = Number(settings.carbTarget);
  const carbValid =
    settings.carbTarget.trim() !== "" &&
    Number.isFinite(carbTarget) &&
    carbTarget >= 0 &&
    carbTarget <= MAX_CARBS_PER_HOUR;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !carbValid) return;
    create.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan a route</CardTitle>
        <CardDescription>
          Upload the GPX of a route you plan to ride, run or hike. VO2 predicts how it will go from
          your own activities, then builds fuel plans from MNSTRY products.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={fileError != null}>
              <FieldLabel htmlFor="route-gpx">GPX file</FieldLabel>
              {/* iOS has no type for .gpx, so the picker greys it out unless generic types pass. */}
              <Input
                id="route-gpx"
                type="file"
                accept=".gpx,application/gpx+xml,application/xml,text/xml,application/octet-stream"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFileError(
                    next && next.size > MAX_GPX_BYTES ? "This GPX file is larger than 5 MB." : null,
                  );
                  setFile(next && next.size <= MAX_GPX_BYTES ? next : null);
                }}
              />
              {fileError ? <FieldDescription>{fileError}</FieldDescription> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="route-sport">Sport</FieldLabel>
              <Select
                value={sportType}
                onValueChange={(value) => {
                  if (value == null) return;
                  const next = value as RouteSportType;
                  const changesGroup = routeSportGroup(next) !== routeSportGroup(sportType);
                  setSportType(next);
                  if (changesGroup) setSettings(settingsFor(next, defaults));
                }}
              >
                <SelectTrigger id="route-sport" className="w-full sm:w-48">
                  <SelectValue>{formatSportType(sportType)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {ROUTE_SPORT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {formatSportType(type)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={!carbValid}>
              <FieldLabel htmlFor="route-carbs">Carbs per hour</FieldLabel>
              <Input
                id="route-carbs"
                type="text"
                inputMode="numeric"
                className="max-w-32"
                value={settings.carbTarget}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, carbTarget: event.target.value }))
                }
              />
              <FieldDescription>
                {carbValid
                  ? `Grams per hour. ${DEFAULT_CARB_TARGET[routeSportGroup(sportType) ?? "cycling"]} g/h is the default for this sport.`
                  : `Enter 0 to ${MAX_CARBS_PER_HOUR} g per hour.`}
              </FieldDescription>
            </Field>
            <BottleFields
              idPrefix="route"
              count={settings.bottleCount}
              ml={settings.bottleMl}
              mix={settings.mixBottleCount}
              onChange={(next) => setSettings((current) => ({ ...current, ...next }))}
            />
            {create.error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {create.error.message || "Could not plan this route."}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={!file || !carbValid || create.isPending}>
              {create.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadIcon data-icon="inline-start" />
              )}
              {create.isPending ? "Predicting your route…" : "Upload and plan"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
