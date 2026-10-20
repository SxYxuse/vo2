"use client";

import { useMemo } from "react";
import { Controller, useFormState, useWatch, type Control, type FieldPath } from "react-hook-form";

import type { SportsFormInput } from "@/lib/settings-form.ts";
import {
  ACTIVITY_COLOR_OPTIONS,
  formatSportType,
  heartRateCollectorLabel,
  sortSportTypeKeys,
  sportOffersPower,
  type CalendarSettings,
} from "@/services/calendar-settings.ts";
import { SPORT_GROUPS } from "@/services/sport-groups.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

function colorLabel(value: string) {
  return ACTIVITY_COLOR_OPTIONS.find((option) => option.value === value)?.label ?? "Custom";
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function sportColor(value: unknown, fallback?: string) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return ACTIVITY_COLOR_OPTIONS[0]?.value ?? "";
}

export function SportTypesFields<T extends SportsFormInput>({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<T>;
}) {
  const sportTypes = (useWatch({ control, name: "sportTypes" as FieldPath<T> }) ??
    {}) as CalendarSettings["sportTypes"];
  const { errors } = useFormState({ control, name: "sportTypes" as FieldPath<T> });
  const sportTypesError = (errors as { sportTypes?: { message?: string } }).sportTypes;

  const sortedSports = useMemo(() => sortSportTypeKeys(sportTypes), [sportTypes]);
  const shareableGroups = useMemo(
    () =>
      SPORT_GROUPS.map((group) => ({
        ...group,
        members: group.members.filter((member) => sportTypes[member]),
      })).filter((group) => group.members.length >= 2),
    [sportTypes],
  );

  if (sortedSports.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No activity types yet</EmptyTitle>
          <EmptyDescription>
            Sync from Strava to choose which sports appear in the calendar, map, and heart rate.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <FieldGroup className="gap-3">
      {sportTypesError?.message ? <FieldError>{sportTypesError.message}</FieldError> : null}
      {shareableGroups.length ? (
        <>
          <FieldSet>
            <FieldLegend>Shared data</FieldLegend>
            <FieldDescription>
              When on, types in the group share one max heart rate and zone set — a peak on a gravel
              ride also sets indoor and road ride zones.
            </FieldDescription>
            {shareableGroups.map((group) => {
              const inputId = `${idPrefix}-group-${group.id}`;
              const name = `sportGroupShares.${group.id}` as FieldPath<T>;
              return (
                <Controller
                  key={group.id}
                  name={name}
                  control={control}
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Switch
                        id={inputId}
                        checked={Boolean(field.value)}
                        onCheckedChange={field.onChange}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={inputId} className="font-normal">
                          {group.label}
                        </FieldLabel>
                        <FieldDescription>
                          {group.members.map(formatSportType).join(", ")}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  )}
                />
              );
            })}
          </FieldSet>
          <FieldSeparator />
        </>
      ) : null}
      <FieldDescription>
        These types and colors apply to the calendar, map, heart rate, and other views. Mark the
        hardware you actually use — Ride with an HR belt and power-meter pedals, gravel with a belt
        only, running with an HR watch — so structured sessions can prescribe watts, heart rate, or
        RPE.
      </FieldDescription>
      {sortedSports.map((sportType) => {
        const typeSettings = sportTypes[sportType];
        const inputId = `${idPrefix}-type-${sportType}`;
        const heartId = `${inputId}-hr`;
        const powerId = `${inputId}-power`;
        const offersPower = sportOffersPower(sportType);
        return (
          <FieldSet key={sportType} className="gap-3 rounded-lg border p-3">
            <Field orientation="horizontal">
              <Controller
                name={`sportTypes.${sportType}.visible` as FieldPath<T>}
                control={control}
                render={({ field }) => (
                  <Switch
                    id={inputId}
                    checked={Boolean(field.value)}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <FieldLabel htmlFor={inputId} className="min-w-0 flex-1 font-normal">
                {formatSportType(sportType)}
              </FieldLabel>
              <Controller
                name={`sportTypes.${sportType}.color` as FieldPath<T>}
                control={control}
                render={({ field }) => {
                  const color = sportColor(field.value, typeSettings?.color);
                  return (
                    <Select
                      value={color}
                      onValueChange={(next) => {
                        if (next == null) return;
                        field.onChange(String(next));
                      }}
                    >
                      <SelectTrigger
                        id={`${inputId}-color`}
                        size="sm"
                        className="w-28"
                        aria-label={`${formatSportType(sportType)} color`}
                      >
                        <SelectValue>
                          <span className="flex items-center gap-2">
                            <ColorDot color={color} />
                            {colorLabel(color)}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {ACTIVITY_COLOR_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <ColorDot color={option.value} />
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  );
                }}
              />
            </Field>
            <FieldSet className="gap-2 ps-8">
              <FieldLegend variant="label">Collectors</FieldLegend>
              <FieldGroup className="flex-row flex-wrap gap-4">
                <Field orientation="horizontal">
                  <Controller
                    name={`sportTypes.${sportType}.heartRate` as FieldPath<T>}
                    control={control}
                    render={({ field }) => (
                      <Switch
                        id={heartId}
                        checked={field.value !== false}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={heartId} className="font-normal">
                    {heartRateCollectorLabel(sportType)}
                  </FieldLabel>
                </Field>
                {offersPower ? (
                  <Field orientation="horizontal">
                    <Controller
                      name={`sportTypes.${sportType}.power` as FieldPath<T>}
                      control={control}
                      render={({ field }) => (
                        <Switch
                          id={powerId}
                          checked={field.value === true}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel htmlFor={powerId} className="font-normal">
                      Power meter
                    </FieldLabel>
                  </Field>
                ) : null}
              </FieldGroup>
            </FieldSet>
          </FieldSet>
        );
      })}
    </FieldGroup>
  );
}
