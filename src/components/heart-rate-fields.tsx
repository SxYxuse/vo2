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
  ZONE_METHODS,
  ZONED_FAMILY_LABELS,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "@/services/heart-rate-settings.ts";
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

function estimateText(value: number | null) {
  return value == null ? "No estimate yet" : `Estimated ${value}`;
}

function zoneTops(family: ZonedFamily, resolved: ResolvedHeartRate) {
  const zones = zonesFromHistogram(emptyHistogram(), SPORT_TYPE[family], resolved);
  return zones.slice(0, 4).map((zone) => zone.maxBpm);
}

function BpmField({
  id,
  name,
  label,
  placeholder,
  description,
  issue,
  control,
}: {
  id: string;
  name: BpmPath;
  label: string;
  placeholder: string;
  description?: string;
  issue?: string;
  control: Control<SettingsFormInput>;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message ?? issue;
        return (
          <Field data-invalid={Boolean(message)}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <InputGroup className="max-w-48">
              <InputGroupInput
                id={id}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={placeholder}
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
}: {
  idPrefix: string;
  control: Control<SettingsFormInput>;
  setValue: UseFormSetValue<SettingsFormInput>;
  estimates: HeartRateEstimates;
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
        Leave a field blank to use VO2's estimate. Changes rescore every past activity.
      </FieldDescription>
      <BpmField
        id={`${idPrefix}-rest-hr`}
        name="heartRate.restHr"
        label="Resting heart rate"
        placeholder={estimateText(estimates.restHr)}
        description="The floor of heart-rate reserve, for zones and training load."
        issue={issueAt("restHr")}
        control={control}
      />
      {ZONED_FAMILIES.map((family) => {
        const base = `heartRate.sports.${family}` as const;
        const resolved = resolve(family);
        // Placeholders show what each blank field would resolve to.
        const lthrEstimate = resolve(family, {
          ...settings,
          sports: { ...settings.sports, [family]: { ...settings.sports[family], lthr: null } },
        }).lthr;
        const missing = missingAnchor(resolved);
        const zones = missing
          ? null
          : zonesFromHistogram(emptyHistogram(), SPORT_TYPE[family], resolved);
        const methodId = `${idPrefix}-${family}-method`;
        return (
          // The border sits on a wrapper: a bordered fieldset draws its legend into the
          // line, and iOS Safari ignores the float that would undo it in a flex fieldset.
          <div key={family} className="rounded-lg border p-3">
            <FieldSet className="gap-4">
              <FieldLegend className="mb-0">{ZONED_FAMILY_LABELS[family]}</FieldLegend>
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
                    <FieldDescription>
                      {ZONE_METHODS.find((method) => method.id === field.value)?.hint}
                    </FieldDescription>
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
                placeholder={estimateText(lthrEstimate)}
                description="Lactate-threshold heart rate. Scores heart-rate training load."
                issue={issueAt(`sports.${family}.lthr`)}
                control={control}
              />
              <BpmField
                id={`${idPrefix}-${family}-max-hr`}
                name={`${base}.maxHr`}
                label="Max heart rate"
                placeholder={estimateText(estimates.maxHr[family])}
                description="Replaces your recent peak, with no spike or age check."
                control={control}
              />
              {missing ? (
                <FieldError>Needs {MISSING_LABEL[missing]}</FieldError>
              ) : zones ? (
                <p className="text-sm text-muted-foreground">
                  {zones
                    .map(
                      (zone, index) =>
                        `Z${index + 1} ${formatZoneBpm(zone, index === zones.length - 1)}`,
                    )
                    .join(" · ")}
                </p>
              ) : null}
            </FieldSet>
          </div>
        );
      })}
    </FieldGroup>
  );
}
