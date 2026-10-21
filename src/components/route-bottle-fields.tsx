"use client";

import { MinusIcon, PlusIcon } from "lucide-react";

import { BOTTLE_PRESETS_ML } from "@/services/route-plan.ts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const MAX_BOTTLES = 6;

type BottleChange = { bottleCount?: number; bottleMl?: number; mixBottleCount?: number | null };

/**
 * How many bottles the athlete carries, how many hold drink mix, and their size: the drink in a
 * plan never exceeds it.
 */
export function BottleFields({
  idPrefix,
  count,
  ml,
  mix,
  onChange,
}: {
  idPrefix: string;
  count: number;
  ml: number;
  /** Bottles with drink mix; null lets the plan decide. */
  mix: number | null;
  onChange: (next: BottleChange) => void;
}) {
  const preset = BOTTLE_PRESETS_ML.find((size) => size === ml);
  // Fewer bottles can't hold more mix bottles than before; none carried means no choice left.
  const setCount = (next: number) =>
    onChange({
      bottleCount: next,
      ...(mix != null && mix > next ? { mixBottleCount: next > 0 ? next : null } : {}),
    });
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-bottles`}>Bottles carried</FieldLabel>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="One bottle fewer"
            disabled={count <= 0}
            onClick={() => setCount(Math.max(0, count - 1))}
          >
            <MinusIcon />
          </Button>
          <output id={`${idPrefix}-bottles`} className="w-8 text-center text-lg tabular-nums">
            {count}
          </output>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="One bottle more"
            disabled={count >= MAX_BOTTLES}
            onClick={() => setCount(Math.min(MAX_BOTTLES, count + 1))}
          >
            <PlusIcon />
          </Button>
        </div>
        <FieldDescription>
          Sipped through the session. The plan says when to refill.
        </FieldDescription>
      </Field>
      {count > 1 ? (
        <Field>
          <FieldLabel id={`${idPrefix}-mix-label`}>Bottles with drink mix</FieldLabel>
          <ToggleGroup
            size="sm"
            variant="outline"
            spacing={0}
            aria-labelledby={`${idPrefix}-mix-label`}
            value={[mix == null ? "auto" : String(mix)]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "auto") onChange({ mixBottleCount: null });
              else if (value) onChange({ mixBottleCount: Number(value) });
            }}
          >
            <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
            {Array.from({ length: count }, (_, index) => (
              <ToggleGroupItem key={index + 1} value={String(index + 1)}>
                {index + 1}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            {mix == null
              ? "The plan picks how many bottles get mix; the rest are water."
              : mix < count
                ? `${mix} with mix, mixed as strong as the plan needs; ${count - mix} with water for your gels.`
                : "Every bottle gets mix."}
          </FieldDescription>
        </Field>
      ) : null}
      {count > 0 ? (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-bottle-ml`}>Bottle size</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={0}
              value={preset ? [String(preset)] : []}
              onValueChange={(next) => {
                const size = Number(next[0]);
                if (size) onChange({ bottleMl: size });
              }}
            >
              {BOTTLE_PRESETS_ML.map((size) => (
                <ToggleGroupItem key={size} value={String(size)}>
                  {size}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <InputGroup className="max-w-32">
              <InputGroupInput
                id={`${idPrefix}-bottle-ml`}
                type="text"
                inputMode="numeric"
                value={String(ml)}
                onChange={(event) => {
                  const size = Number(event.target.value.replace(/\D/g, ""));
                  onChange({ bottleMl: Math.min(1500, size) });
                }}
                onBlur={() => onChange({ bottleMl: Math.max(100, ml) })}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>ml</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </div>
        </Field>
      ) : null}
    </>
  );
}
