import { z } from "zod";

import catalogJson from "@/data/mnstry-catalog.json";

export const FUEL_KINDS = ["gel", "chew", "drink", "bar", "other"] as const;
export type FuelKind = (typeof FUEL_KINDS)[number];

const MISSING_FIELDS = ["serving", "carbsG", "glucoseFructose", "caffeineMg"] as const;

export const fuelProductSchema = z.object({
  /** Shopify handle. */
  id: z.string(),
  name: z.string(),
  /** Shopify product type, e.g. "GEL40". */
  line: z.string(),
  kind: z.enum(FUEL_KINDS),
  flavour: z.string().nullable(),
  url: z.string(),
  serving: z
    .object({
      /** As the store writes it: "60 ml", "85 g". */
      label: z.string(),
      grams: z.number().nullable(),
      /** Water one serving of a drink mix goes into; null for everything else. */
      mixMl: z.number().nullable(),
    })
    .nullable(),
  carbsG: z.number().nullable(),
  /** "2:1", "1:0.8". */
  glucoseFructose: z.string().nullable(),
  /** Null means the store doesn't state it, never "none". */
  caffeineMg: z.number().nullable(),
  /** Pack sizes; nutrition is the same across them. */
  variants: z.array(z.string()),
  missing: z.array(z.enum(MISSING_FIELDS)),
  sourceUpdatedAt: z.string(),
});

export const fuelCatalogSchema = z.object({
  fetchedAt: z.string(),
  source: z.string(),
  products: z.array(fuelProductSchema),
});

export type FuelProduct = z.infer<typeof fuelProductSchema>;
export type FuelCatalog = z.infer<typeof fuelCatalogSchema>;
export type MissingField = (typeof MISSING_FIELDS)[number];

let cached: FuelCatalog | null = null;

/** The committed snapshot; the app never fetches the store. */
export function loadFuelCatalog(): FuelCatalog {
  cached ??= fuelCatalogSchema.parse(catalogJson);
  return cached;
}

/**
 * Products the planner may use: session fuel with stated carbs. A drink mix also needs the
 * water volume its serving goes into, or it can't be scaled to the athlete's bottle. A caffeine
 * product that doesn't state its dose can't be kept under the caffeine cap.
 */
export function isPlannable(product: FuelProduct) {
  if (product.kind === "other" || product.carbsG == null) return false;
  if (product.missing.includes("caffeineMg")) return false;
  if (product.kind === "drink") return product.serving?.mixMl != null;
  return true;
}

export function planningProducts(catalog: FuelCatalog = loadFuelCatalog()) {
  return catalog.products.filter(isPlannable);
}
