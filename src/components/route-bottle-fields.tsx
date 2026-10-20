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

/** How many bottles the athlete carries and their size: the drink in a plan never exceeds it. */
export function BottleFields({
  idPrefix,
  count,
  ml,
  onChange,
}: {
  idPrefix: string;
  count: number;
  ml: number;
  onChange: (next: { bottleCount?: number; bottleMl?: number }) => void;
}) {
  const preset = BOTTLE_PRESETS_ML.find((size) => size === ml);
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
            onClick={() => onChange({ bottleCount: Math.max(0, count - 1) })}
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
            onClick={() => onChange({ bottleCount: Math.min(MAX_BOTTLES, count + 1) })}
          >
            <PlusIcon />
          </Button>
        </div>
        <FieldDescription>
          No refills are planned. Spare bottles are planned as water.
        </FieldDescription>
      </Field>
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
