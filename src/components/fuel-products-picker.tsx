"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageIcon } from "lucide-react";

import { routePlansQueryOptions } from "@/lib/queries.ts";
import {
  isPlannable,
  loadFuelCatalog,
  type FuelKind,
  type FuelProduct,
} from "@/services/fuel-catalog.ts";
import { saveFuelProducts } from "@/services/route-plan.ts";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const GROUPS: { kind: FuelKind; label: string }[] = [
  { kind: "drink", label: "Drink mixes" },
  { kind: "gel", label: "Gels" },
  { kind: "chew", label: "Chews" },
  { kind: "bar", label: "Bars" },
];

/** Session fuel from the catalog, plannable or not: unplannable ones show why they can't be picked. */
const FUEL = loadFuelCatalog().products.filter((product) => product.kind !== "other");

function detail(product: FuelProduct) {
  if (!isPlannable(product)) return "Nutrition not published";
  const parts = [`${product.carbsG} g carbs`];
  if (product.serving?.mixMl) parts[0] += ` per ${product.serving.mixMl} ml`;
  if (product.glucoseFructose) parts.push(product.glucoseFructose);
  if (product.caffeineMg) parts.push(`${product.caffeineMg} mg caffeine`);
  return parts.join(" · ");
}

/** The MNSTRY products the athlete has; fuel plans are only made from these. */
export function FuelProductsPicker({ productIds }: { productIds: string[] | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(productIds ?? []));
  const save = useMutation({
    mutationFn: () => saveFuelProducts({ data: { productIds: [...selected] } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: routePlansQueryOptions.queryKey });
      setOpen(false);
    },
  });
  const plannable = FUEL.filter(isPlannable);
  const count = (productIds ?? []).length;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Your MNSTRY products</CardTitle>
        <CardDescription>
          {count > 0
            ? `${count} product${count > 1 ? "s" : ""}. Fuel plans only use what you have.`
            : "Choose the products you have before planning a route."}
        </CardDescription>
        <CardAction>
          <Button
            variant={count > 0 ? "outline" : "default"}
            size="sm"
            onClick={() => {
              setSelected(new Set(productIds ?? []));
              setOpen(true);
            }}
          >
            <PackageIcon data-icon="inline-start" />
            {count > 0 ? "Edit" : "Choose"}
          </Button>
        </CardAction>
      </CardHeader>

      <ResponsiveDialog open={open} onOpenChange={(next) => !save.isPending && setOpen(next)}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Your MNSTRY products</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Tick what you have at home. Plans and swaps only use these.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex items-center gap-2 px-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set(plannable.map((product) => product.id)))}
            >
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <span className="text-muted-foreground ms-auto text-xs tabular-nums">
              {selected.size} selected
            </span>
          </div>
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto px-4 pb-2">
            {GROUPS.map((group) => {
              const products = FUEL.filter((product) => product.kind === group.kind);
              if (products.length === 0) return null;
              return (
                <section key={group.kind} className="flex flex-col gap-1">
                  <h3 className="text-muted-foreground text-xs font-medium uppercase">
                    {group.label}
                  </h3>
                  {products.map((product) => (
                    <Field key={product.id} orientation="horizontal" className="min-h-11 py-1">
                      <Checkbox
                        id={`fuel-${product.id}`}
                        checked={selected.has(product.id)}
                        disabled={!isPlannable(product)}
                        onCheckedChange={(checked) => toggle(product.id, checked)}
                      />
                      <FieldLabel
                        htmlFor={`fuel-${product.id}`}
                        className="flex-col items-start gap-0"
                      >
                        <span>{product.name}</span>
                        <span className="text-muted-foreground text-xs font-normal">
                          {detail(product)}
                        </span>
                      </FieldLabel>
                    </Field>
                  ))}
                </section>
              );
            })}
          </div>
          <ResponsiveDialogFooter>
            {save.error ? <p className="text-destructive text-sm">{save.error.message}</p> : null}
            <Button disabled={selected.size === 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save products
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  );
}
