/**
 * Documents the Seed demo catalog shapes used by Catalog Health
 * (`intent: seedDemoCatalog` in app._index.tsx).
 *
 * Prefer the in-app button — it creates real Shopify products labeled [Demo].
 * This file is the source-of-truth description for demos and evaluation.
 */

export const DEMO_CATALOG = [
  {
    key: "match",
    title: "[Demo] Black Leather Wallet (Correct)",
    productType: "Wallet",
    color: "Black",
    hasImage: true,
    expected: "MATCH (when image is clearly black)",
  },
  {
    key: "color",
    title: "[Demo] Red Leather Wallet",
    productType: "Wallet",
    color: "Red",
    hasImage: true,
    expected: "Color MISMATCH (black image vs Red listing) — golden path",
  },
  {
    key: "material",
    title: "[Demo] Plastic Wallet",
    productType: "Wallet",
    color: "Black",
    hasImage: true,
    expected: "Material review when vision detects leather",
  },
  {
    key: "type",
    title: "[Demo] Travel Bag",
    productType: "Bag",
    color: "Black",
    hasImage: true,
    expected: "Product type review when vision detects wallet",
  },
  {
    key: "missing",
    title: "[Demo] Leather Wallet (No Image)",
    productType: "Wallet",
    color: "Brown",
    hasImage: false,
    expected: "Graceful failure — no usable image",
  },
] as const;

console.log("Demo catalog cases:");
for (const d of DEMO_CATALOG) {
  console.log(`  [${d.key}] ${d.title}`);
  console.log(`      expected: ${d.expected}`);
}
console.log("\nSeed from Catalog Health → Demo tools → Seed demo catalog.");
