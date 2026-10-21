import type { FuelKind, FuelProduct, MissingField } from "./fuel-catalog.ts";

/** The fields of a Shopify `products.json` entry the import reads. */
export type ShopifyProduct = {
  handle: string;
  title: string;
  product_type: string;
  tags: string[];
  body_html: string;
  updated_at: string;
  variants: { title: string }[];
};

const KIND_BY_LINE: Record<string, FuelKind> = {
  GEL40: "gel",
  "ICE-GEL 40": "gel",
  // Squeezable pouch, planned as the solid next to gels, not as another gel.
  "JELLY 40": "jelly",
  "CHEW 40": "chew",
  "SLOW CARB": "drink",
  "FAST CARB": "drink",
  "POWER CARB": "drink",
  "RACE CARB X": "drink",
  "PERFORMANCE BAR": "bar",
  "INTENSITY BAR": "bar",
  PORRIDGEBAR: "bar",
  // BICARB GEL 40 is taken before a session on its own protocol, so it stays "other".
};

export function fuelKind(productType: string): FuelKind {
  return KIND_BY_LINE[productType.trim().toUpperCase()] ?? "other";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[⁠​]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "40,0" and "81.4" are both decimals on this store. */
function parseNumber(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function cells(rowHtml: string, tag: "td" | "th") {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  return [...rowHtml.matchAll(pattern)].map((match) => htmlToText(match[1] ?? ""));
}

/**
 * Reads the "Données nutritionnelles" table: carbs in the "Par portion (…)" column.
 * This table is the store's own per-serving figure, so it wins over the description.
 */
export function parseNutritionTable(pageHtml: string) {
  const table = /<table[^>]*class="[^"]*nutrition-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(
    pageHtml,
  )?.[1];
  if (!table) return null;
  const header = cells(table, "th");
  const column = header.findIndex((cell) => /^par portion/i.test(cell));
  if (column === -1) return null;
  const servingLabel = /\(([^)]+)\)/.exec(header[column] ?? "")?.[1]?.trim() ?? null;

  let carbsG: number | null = null;
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const values = cells(row[1] ?? "", "td");
    if (!/^glucides/i.test(values[0] ?? "")) continue;
    const match = /(\d+(?:[.,]\d+)?)/.exec(values[column] ?? "");
    carbsG = match ? parseNumber(match[1] ?? "") : null;
    break;
  }
  return { servingLabel, carbsG };
}

/** Text of the product's own accordion panels (ingredients, nutrition, dosage). */
export function productPanelsText(pageHtml: string) {
  const starts = [...pageHtml.matchAll(/class="faq-wrapper"/g)].map((match) => match.index);
  if (starts.length === 0) return "";
  const first = starts[0] ?? 0;
  const last = starts.at(-1) ?? first;
  return htmlToText(pageHtml.slice(first, last + 3000));
}

/** Facts the store states in prose. Every value is null unless a sentence says it. */
export function parseProse(text: string) {
  // "jusqu'à 120 grammes de glucides par heure" is an hourly ceiling, not a serving.
  const carbs = /(\d+(?:[.,]\d+)?)\s*(?:grammes|g) de glucides(?! par heure)/i.exec(text);
  const ratio = /(?:rapport|ratio)[^.:\d]{0,60}?(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/i.exec(
    text,
  );
  // "3 à 6 mg de caféine par kilogramme" is the store's dosing advice, not the content.
  const caffeine = /(\d+)\s*mg de caféine(?!\s*par\s*kilo)/i.exec(text);
  const mix =
    /(?:par|pour) (?:portion de )?(\d+)\s*ml/i.exec(text) ??
    /(?:avec|mélangées à) (\d+)\s*ml d['’]eau/i.exec(text);
  return {
    carbsG: carbs ? parseNumber(carbs[1] ?? "") : null,
    glucoseFructose: ratio ? `${ratio[1]?.replace(",", ".")}:${ratio[2]?.replace(",", ".")}` : null,
    caffeineMg: caffeine ? Number(caffeine[1]) : null,
    mixMl: mix ? Number(mix[1]) : null,
  };
}

/** "CAFFEINE GEL 40 Cherry 1:0.8" → "Cherry": the store writes the line in capitals. */
export function flavourFromTitle(title: string) {
  const words = title
    .replace(/\b\d+(?:[.,]\d+)?:\d+(?:[.,]\d+)?\b/g, "")
    .trim()
    .split(/\s+/);
  const firstMixed = words.findIndex((word) => /[a-zà-ÿ]/.test(word));
  if (firstMixed === -1) return null;
  const flavour = words.slice(firstMixed).join(" ").trim();
  return flavour === "" ? null : flavour;
}

function servingGrams(label: string | null) {
  const match = label ? /^(\d+(?:[.,]\d+)?)\s*g$/i.exec(label) : null;
  return match ? parseNumber(match[1] ?? "") : null;
}

export function buildFuelProduct(
  product: ShopifyProduct,
  pageHtml: string | null,
  url: string,
): FuelProduct {
  const kind = fuelKind(product.product_type);
  const table = pageHtml ? parseNutritionTable(pageHtml) : null;
  const description = parseProse(htmlToText(product.body_html));
  const panels = pageHtml ? parseProse(productPanelsText(pageHtml)) : null;

  const carbsG = table?.carbsG ?? description.carbsG ?? panels?.carbsG ?? null;
  const glucoseFructose = description.glucoseFructose ?? panels?.glucoseFructose ?? null;
  const caffeineMg = description.caffeineMg ?? panels?.caffeineMg ?? null;
  const mixMl = kind === "drink" ? (description.mixMl ?? panels?.mixMl ?? null) : null;
  const servingLabel = table?.servingLabel ?? (mixMl != null ? `${mixMl} ml` : null);
  const serving =
    servingLabel != null || mixMl != null
      ? { label: servingLabel ?? `${mixMl} ml`, grams: servingGrams(servingLabel), mixMl }
      : null;

  const missing: MissingField[] = [];
  if (serving == null) missing.push("serving");
  if (carbsG == null) missing.push("carbsG");
  if (glucoseFructose == null) missing.push("glucoseFructose");
  if (caffeineMg == null && product.tags.some((tag) => tag.toLowerCase() === "caffeine")) {
    missing.push("caffeineMg");
  }

  return {
    id: product.handle,
    name: product.title.trim(),
    line: product.product_type.trim(),
    kind,
    flavour: flavourFromTitle(product.title),
    url,
    serving,
    carbsG,
    glucoseFructose,
    caffeineMg,
    variants: product.variants.map((variant) => variant.title),
    missing,
    sourceUpdatedAt: product.updated_at,
  };
}
