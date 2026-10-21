"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageIcon, SearchIcon } from "lucide-react";

import { routePlansQueryOptions } from "@/lib/queries.ts";
import {
  hasPlanningKit,
  isPlannable,
  loadFuelCatalog,
  missingKit,
  ownedProducts,
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

const GROUPS: { kind: FuelKind; label: string }[] = [
  { kind: "drink", label: "Drink mixes" },
  { kind: "gel", label: "Gels" },
  { kind: "jelly", label: "Jellies" },
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

function listOf(items: string[]) {
  return items.join(", ").replace(/, ([^,]*)$/, " and $1");
}

/** The MNSTRY products the athlete has; fuel plans are only made from these. */
export function FuelProductsPicker({ productIds }: { productIds: string[] | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(productIds ?? []));
  const [query, setQuery] = useState("");
  const save = useMutation({
    mutationFn: () => saveFuelProducts({ data: { productIds: [...selected] } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: routePlansQueryOptions.queryKey });
      setOpen(false);
    },
  });
  const owned = ownedProducts(productIds);
  const count = (productIds ?? []).length;
  const ready = hasPlanningKit(owned);
  const missing = missingKit(owned);
  const stillMissing = missingKit(FUEL.filter((product) => selected.has(product.id)));
  const search = query.trim().toLowerCase();

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
          {count === 0
            ? "Choose the products you have first. Each plan uses a drink mix, one solid, and gels."
            : ready
              ? `${count} product${count > 1 ? "s" : ""}. Fuel plans only use what you have.`
              : `Add ${listOf(missing)} to plan a route.`}
        </CardDescription>
        <CardAction>
          <Button
            variant={count > 0 ? "outline" : "default"}
            size="sm"
            onClick={() => {
              setSelected(new Set(productIds ?? []));
              setQuery("");
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
              Tick what you have at home. Every plan needs a drink mix, one jelly or bar, and gels.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex flex-col gap-2 px-4">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="Search products"
                placeholder="Search, e.g. power carb or mango"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs ${stillMissing.length > 0 ? "text-ds-amber-900" : "text-muted-foreground"}`}
              >
                {stillMissing.length > 0
                  ? `Still needed: ${listOf(stillMissing)}.`
                  : `${selected.size} selected. Ready to plan.`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto px-4 pb-2">
            {GROUPS.map((group) => {
              const products = FUEL.filter(
                (product) =>
                  product.kind === group.kind &&
                  (!search || product.name.toLowerCase().includes(search)),
              );
              if (products.length === 0) return null;
              const picked = products.filter((product) => selected.has(product.id)).length;
              return (
                <section key={group.kind} className="flex flex-col gap-1">
                  <h3 className="text-muted-foreground text-xs font-medium uppercase">
                    {group.label}
                    {picked > 0 ? ` · ${picked}` : ""}
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
            {search && !FUEL.some((product) => product.name.toLowerCase().includes(search)) ? (
              <p className="text-muted-foreground py-4 text-sm">No product matches “{query}”.</p>
            ) : null}
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
