import { describe, expect, it } from "vite-plus/test";

import { buildFuelProduct, type ShopifyProduct } from "./fuel-catalog-parse.ts";
import { isPlannable, loadFuelCatalog, ownedProducts, planningProducts } from "./fuel-catalog.ts";

// Trimmed from the real mnstry.com pages.
function nutritionTable(serving: string, carbs: string) {
  return `<div class="faq-wrapper"><a>Données nutritionnelles</a><div class="panel">
<table class="nutrition-table"><thead><tr><th>Valeurs nutritives</th>
<th>Pour 100 g</th><th>Par portion (${serving})</th></tr></thead>
<tbody><tr><td>Énergie</td><td>1.134 kJ / 267 kcal</td><td>680 kJ / 160 kcal</td></tr>
<tr><td>Glucides</td><td>66,0 g</td><td>${carbs}</td></tr>
<tr><td>dont sucres</td><td>22,0 g</td><td>13,0 g</td></tr></tbody></table></div></div>`;
}

function dosage(text: string) {
  return `<div class="faq-wrapper"><a>Dosage</a><div class="panel"><p>${text}</p></div></div>`;
}

function shopify(overrides: Partial<ShopifyProduct>): ShopifyProduct {
  return {
    handle: "gel-40-mango",
    title: "GEL 40 Mango",
    product_type: "GEL40",
    tags: ["gel", "PG1"],
    body_html: "",
    updated_at: "2026-09-01T10:00:00+02:00",
    variants: [{ title: "PACK OF 6" }, { title: "PACK OF 12" }],
    ...overrides,
  };
}

const url = "https://mnstry.com/fr-eu/products/x";

describe("buildFuelProduct", () => {
  it("reads a gel's carbs from the per-serving column, even without a unit", () => {
    const product = buildFuelProduct(
      shopify({
        body_html:
          "<p>fournit 40 grammes de glucides par portion, dans un rapport glucose/fructose de 2:1.</p>",
      }),
      nutritionTable("60 ml", "40,0"),
      url,
    );

    expect(product).toMatchObject({
      kind: "gel",
      flavour: "Mango",
      serving: { label: "60 ml", grams: null, mixMl: null },
      carbsG: 40,
      glucoseFructose: "2:1",
      caffeineMg: null,
      variants: ["PACK OF 6", "PACK OF 12"],
      missing: [],
    });
  });

  it("prefers the table over the description when they disagree", () => {
    const product = buildFuelProduct(
      shopify({
        handle: "power-carb-blackcurrant",
        title: "POWER CARB Blackcurrant",
        product_type: "POWER CARB",
        body_html:
          "<p>contient 80 grammes de glucides pour 500 ml, dans un rapport glucose/fructose de 2:1</p>",
      }),
      nutritionTable("85 g", "80,8 g"),
      url,
    );

    expect(product).toMatchObject({
      kind: "drink",
      serving: { label: "85 g", grams: 85, mixMl: 500 },
      carbsG: 80.8,
    });
  });

  it("takes a drink's water volume from the dosage panel", () => {
    const product = buildFuelProduct(
      shopify({ product_type: "FAST CARB", title: "FAST CARB Lemon 1:0.8" }),
      nutritionTable("43 g", "40,2 g") +
        dosage(
          "4 cuillères de FAST CARB Lemon 1:0.8 (poids : 43 grammes) mélangées à 500 ml d'eau.",
        ),
      url,
    );

    expect(product.serving?.mixMl).toBe(500);
    expect(product.flavour).toBe("Lemon");
  });

  it("falls back to the description when the page has no table", () => {
    const product = buildFuelProduct(
      shopify({
        title: "CHEW 40 Lemon 1:0.8",
        product_type: "CHEW 40",
        body_html:
          "<p>Avec 40 grammes de glucides dans un rapport glucose/fructose de 1:0,8, elle permet une absorption pouvant atteindre 120 grammes par heure.</p>",
      }),
      "<html></html>",
      url,
    );

    expect(product).toMatchObject({
      kind: "chew",
      serving: null,
      carbsG: 40,
      glucoseFructose: "1:0.8",
      missing: ["serving"],
    });
  });

  it("counts stated caffeine, not the store's dosing advice", () => {
    const product = buildFuelProduct(
      shopify({
        tags: ["caffeine", "gel"],
        body_html: "<p>Enrichi de 75 mg de caféine, il fournit 40 grammes de glucides.</p>",
      }),
      nutritionTable("60 ml", "40,0 g") +
        dosage("3 à 6 mg de caféine par kilogramme de poids corporel et par heure."),
      url,
    );

    expect(product.caffeineMg).toBe(75);
  });

  it("flags caffeine as missing on a caffeine product that doesn't state it", () => {
    const product = buildFuelProduct(
      shopify({ tags: ["caffeine", "gel"], body_html: "<p>40 grammes de glucides.</p>" }),
      nutritionTable("60 ml", "40,0 g") +
        dosage("3 à 6 mg de caféine par kilogramme de poids corporel et par heure."),
      url,
    );

    expect(product.caffeineMg).toBeNull();
    expect(product.missing).toEqual(["glucoseFructose", "caffeineMg"]);
  });

  it("never reads an hourly ceiling as a serving", () => {
    const product = buildFuelProduct(
      shopify({
        handle: "race-carb-x",
        title: "RACE CARB X",
        product_type: "RACE CARB X",
        body_html:
          "<p>offre jusqu'à 120 grammes de glucides par heure, grâce à un rapport glucose/fructose de 2:1.</p>",
      }),
      "<html></html>",
      url,
    );

    expect(product.carbsG).toBeNull();
    expect(product.missing).toEqual(["serving", "carbsG"]);
    expect(isPlannable(product)).toBe(false);
  });

  it("keeps non-fuel products but never plans them", () => {
    const product = buildFuelProduct(
      shopify({ title: "BICARB GEL 40 Lemon", product_type: "BICARB GEL 40" }),
      nutritionTable("60 ml", "40,0 g"),
      url,
    );

    expect(product.kind).toBe("other");
    expect(isPlannable(product)).toBe(false);
  });
});

describe("stored catalog", () => {
  it("plans only fuel with stated carbs, and drinks with a stated water volume", () => {
    const products = planningProducts(loadFuelCatalog());

    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(product.kind).not.toBe("other");
      expect(product.carbsG).not.toBeNull();
      if (product.kind === "drink") expect(product.serving?.mixMl).not.toBeNull();
    }
  });

  it("keeps only plannable products the athlete has", () => {
    const owned = ownedProducts(["gel-40-mango", "race-carb-x", "no-such-product", "omega-3"]);

    expect(owned.map((product) => product.id)).toEqual(["gel-40-mango"]);
    expect(ownedProducts(null)).toEqual([]);
  });
});
