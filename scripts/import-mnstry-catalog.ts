import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFuelProduct, type ShopifyProduct } from "../src/services/fuel-catalog-parse.ts";
import { fuelCatalogSchema, type FuelCatalog } from "../src/services/fuel-catalog.ts";

// Developer-run only: the app reads the committed JSON and never fetches the store.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "src/data/mnstry-catalog.json");
const origin = "https://mnstry.com";
const collection = `${origin}/fr-eu/collections/products`;
const PAGE_SIZE = 250;
const DELAY_MS = 400;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { "user-agent": "vo2-catalog-import" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

async function listProducts() {
  const products: ShopifyProduct[] = [];
  for (let page = 1; ; page += 1) {
    const body = JSON.parse(
      await fetchText(`${collection}/products.json?limit=${PAGE_SIZE}&page=${page}`),
    ) as { products: ShopifyProduct[] };
    if (body.products.length === 0) return products;
    products.push(...body.products);
  }
}

async function main() {
  const listed = await listProducts();
  console.log(`Listed ${listed.length} products`);
  const products = [];
  for (const product of listed) {
    const url = `${origin}/fr-eu/products/${product.handle}`;
    const pageHtml = await fetchText(url).catch((error: unknown) => {
      console.warn(`  ${product.handle}: page not read (${String(error)})`);
      return null;
    });
    products.push(buildFuelProduct(product, pageHtml, url));
    await sleep(DELAY_MS);
  }
  products.sort((a, b) => a.id.localeCompare(b.id));

  const catalog: FuelCatalog = fuelCatalogSchema.parse({
    fetchedAt: new Date().toISOString(),
    source: collection,
    products,
  });
  await writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${products.length} products to ${outPath}`);

  for (const product of products) {
    if (product.kind === "other" || product.missing.length === 0) continue;
    console.log(`  ${product.id} (${product.kind}) missing: ${product.missing.join(", ")}`);
  }
}

await main();
