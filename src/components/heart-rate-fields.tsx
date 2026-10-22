"use client";

import { Controller, useWatch, type Control, type UseFormSetValue } from "react-hook-form";

import {
  heartRateFormPreview,
  type HeartRateFormInput,
  type SettingsFormInput,
} from "@/lib/settings-form.ts";
import {
  emptyHistogram,
  formatZoneBpm,
  HR_ZONES,
  missingAnchor,
  resolveHeartRate,
  ZONED_FAMILIES,
  zonesFromHistogram,
  type ResolvedHeartRate,
  type ZonedFamily,
  type ZoneMethod,
} from "@/services/heart-rate.ts";
import {
  heartRateSettingsIssues,
  ZONE_METHOD_ANCHORS,
  ZONE_METHODS,
  ZONED_FAMILY_LABELS,
  zoneMethodHint,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "@/services/heart-rate-settings.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BpmPath =
  | "heartRate.restHr"
  | `heartRate.sports.${ZonedFamily}.lthr`
  | `heartRate.sports.${ZonedFamily}.maxHr`
  | `heartRate.sports.${ZonedFamily}.customZones.${0 | 1 | 2 | 3}`;

const SPORT_TYPE: Record<ZonedFamily, string> = {
  cycling: "Ride",
  running: "Run",
  swimming: "Swim",
};

const MISSING_LABEL = {
  max: "max heart rate",
  lthr: "LTHR",
  rest: "resting heart rate",
  zones: "all four zone tops",
} as const;

function reserveZonesLabel(families: ZonedFamily[]) {
  if (families.length === 0) return undefined;
  const names = families.map((family) => ZONED_FAMILY_LABELS[family].toLowerCase());
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Sets ${list} zones`;
}

function zoneTops(family: ZonedFamily, resolved: ResolvedHeartRate) {
  const zones = zonesFromHistogram(emptyHistogram(), SPORT_TYPE[family], resolved);
  return zones.slice(0, 4).map((zone) => zone.maxBpm);
}

type Estimate = { bpm: number | null; source?: string };

/** Says whether a field uses VO2's estimate or the athlete's value, and offers the way back. */
function EstimateStatus({
  value,
  estimate,
  onReset,
}: {
  value: string;
  estimate: Estimate;
  onReset: () => void;
}) {
  if (value.trim() === "") {
    return (
      <FieldDescription>
        {estimate.bpm == null
          ? "No estimate yet. Enter a value, or sync activities with heart rate."
          : `Using VO2's estimate: ${estimate.bpm} bpm${estimate.source ? `, ${estimate.source}` : ""}.`}
      </FieldDescription>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs/relaxed text-muted-foreground">
      <span>Your value.</span>
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        {estimate.bpm == null ? "Clear" : `Use estimate (${estimate.bpm} bpm)`}
      </Button>
    </div>
  );
}

function BpmField({
  id,
  name,
  label,
  placeholder,
  estimate,
  setsZones,
  description,
  issue,
  control,
  onReset,
}: {
  id: string;
  name: BpmPath;
  label: string;
  placeholder?: string;
  /** Omitted for fields with no estimate to fall back on, such as custom zone tops. */
  estimate?: Estimate;
  /** Badge text naming the zones this field sets, when the zone method reads it. */
  setsZones?: string;
  description?: string;
  issue?: string;
  control: Control<SettingsFormInput>;
  onReset?: () => void;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message ?? issue;
        return (
          <Field data-invalid={Boolean(message)}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              {setsZones ? <Badge variant="secondary">{setsZones}</Badge> : null}
            </div>
            <InputGroup className="max-w-48">
              <InputGroupInput
                id={id}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={placeholder ?? (estimate?.bpm != null ? "Auto" : undefined)}
                name={field.name}
                value={field.value as string}
                aria-invalid={Boolean(message)}
                onBlur={field.onBlur}
                onChange={field.onChange}
                ref={field.ref}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>bpm</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {estimate ? (
              <EstimateStatus
                value={field.value as string}
                estimate={estimate}
                onReset={() => {
                  field.onChange("");
                  onReset?.();
                }}
              />
            ) : null}
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            {message ? <FieldError>{message}</FieldError> : null}
          </Field>
        );
      }}
    />
  );
}

export function HeartRateFields({
  idPrefix,
  control,
  setValue,
  estimates,
  onReset,
}: {
  idPrefix: string;
  control: Control<SettingsFormInput>;
  setValue: UseFormSetValue<SettingsFormInput>;
  estimates: HeartRateEstimates;
  /** Typed fields save on blur, so going back to an estimate asks for its own save. */
  onReset: () => void;
}) {
  const heartRate = useWatch({ control, name: "heartRate" }) as HeartRateFormInput["heartRate"];
  // A half-typed value reads as blank, so the rest of the card keeps up while typing.
  const settings = heartRateFormPreview({ heartRate });
  const issues = heartRateSettingsIssues(settings, estimates);
  const issueAt = (path: string) => issues.find((issue) => issue.path === path)?.message;

  const resolve = (family: ZonedFamily, value: HeartRateSettings = settings) =>
    resolveHeartRate(family, value, {
      restHr: estimates.restHr,
      maxHr: estimates.maxHr[family],
    });

  return (
    <FieldGroup>
      <FieldDescription>
        Blank fields use VO2's estimate. Changes rescore every past activity.
      </FieldDescription>
      <BpmField
        id={`${idPrefix}-rest-hr`}
        name="heartRate.restHr"
        label="Resting heart rate"
        estimate={{ bpm: estimates.restHr }}
        setsZones={reserveZonesLabel(
          ZONED_FAMILIES.filter((family) => settings.sports[family].method === "reserve"),
        )}
        onReset={onReset}
        description="Scores training load, for every sport."
        issue={issueAt("restHr")}
        control={control}
      />
      {ZONED_FAMILIES.map((family) => {
        const base = `heartRate.sports.${family}` as const;
        const resolved = resolve(family);
        // What a blank LTHR would resolve to, given the max heart rate in use.
        const lthrEstimate = resolve(family, {
          ...settings,
          sports: { ...settings.sports, [family]: { ...settings.sports[family], lthr: null } },
        }).lthr;
        const missing = missingAnchor(resolved);
        const zones = missing
          ? null
          : zonesFromHistogram(emptyHistogram(), SPORT_TYPE[family], resolved);
        const methodId = `${idPrefix}-${family}-method`;
        const anchors = ZONE_METHOD_ANCHORS[resolved.method];
        return (
          // The border sits on a wrapper: a bordered fieldset draws its legend into the
          // line, and iOS Safari ignores the float that would undo it in a flex fieldset.
          <div key={family} className="rounded-lg border p-3">
            <FieldSet className="gap-4">
              <FieldLegend className="mb-3">{ZONED_FAMILY_LABELS[family]}</FieldLegend>
              {missing ? (
                <FieldError>Needs {MISSING_LABEL[missing]} to set these zones.</FieldError>
              ) : zones ? (
                <ul className="grid max-w-sm gap-1 text-sm">
                  {zones.map((zone, index) => (
                    <li key={zone.id} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: HR_ZONES[index].color }}
                      />
                      <span className="font-medium">Z{index + 1}</span>
                      <span className="text-muted-foreground">{HR_ZONES[index].name}</span>
                      <span className="ms-auto tabular-nums">
                        {formatZoneBpm(zone, index === zones.length - 1)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Controller
                name={`${base}.method`}
                control={control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={methodId}>Zones</FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={(next) => {
                        if (next == null) return;
                        const method = next as ZoneMethod;
                        const stored = heartRate.sports[family].customZones;
                        if (method === "custom" && stored.every((top) => top === "")) {
                          // Start from the zones in use so the athlete only adjusts them.
                          const tops = zoneTops(family, resolved);
                          if (tops.every((top) => top != null)) {
                            setValue(`${base}.customZones`, tops.map(String), {
                              shouldDirty: true,
                            });
                          }
                        }
                        field.onChange(method);
                      }}
                    >
                      <SelectTrigger id={methodId} className="w-full sm:w-64">
                        <SelectValue>
                          {ZONE_METHODS.find((method) => method.id === field.value)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {ZONE_METHODS.map((method) => (
                            <SelectItem key={method.id} value={method.id}>
                              {method.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>{zoneMethodHint(field.value, family)}</FieldDescription>
                  </Field>
                )}
              />
              {resolved.method === "custom" ? (
                <div className="grid grid-cols-2 gap-3">
                  {([0, 1, 2, 3] as const).map((index) => (
                    <BpmField
                      key={index}
                      id={`${idPrefix}-${family}-zone-${index}`}
                      name={`${base}.customZones.${index}`}
                      label={`${HR_ZONES[index].label} top`}
                      placeholder="bpm"
                      control={control}
                    />
                  ))}
                </div>
              ) : null}
              {issueAt(`sports.${family}.customZones`) ? (
                <FieldError>{issueAt(`sports.${family}.customZones`)}</FieldError>
              ) : null}
              <BpmField
                id={`${idPrefix}-${family}-lthr`}
                name={`${base}.lthr`}
                label="LTHR"
                estimate={{ bpm: lthrEstimate, source: "from your max heart rate" }}
                setsZones={anchors.includes("lthr") ? "Sets these zones" : undefined}
                onReset={onReset}
                description="Lactate threshold: about the highest heart rate you can hold for an hour. Scores training load."
                issue={issueAt(`sports.${family}.lthr`)}
                control={control}
              />
              <BpmField
                id={`${idPrefix}-${family}-max-hr`}
                name={`${base}.maxHr`}
                label="Max heart rate"
                estimate={{ bpm: estimates.maxHr[family], source: "from your recent peaks" }}
                setsZones={anchors.includes("max") ? "Sets these zones" : undefined}
                onReset={onReset}
                description="The highest heart rate you reach in this sport."
                control={control}
              />
            </FieldSet>
          </div>
        );
      })}
    </FieldGroup>
  );
}
