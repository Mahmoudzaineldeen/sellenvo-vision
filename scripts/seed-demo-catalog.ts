/**
 * Documents the Seed demo catalog shapes used by Catalog Health
 * (`intent: seedDemoCatalog` in app._index.tsx).
 *
 * Prefer Catalog Health → Demo tools → Seed demo catalog for live Shopify products.
 * This script prints the reproducible demo story for `npm run demo:seed`.
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
  {
    key: "uncertain",
    title: "[Demo] Ambiguous Product Photo",
    productType: "Wallet",
    color: "Black",
    hasImage: true,
    expected: "UNCERTAIN / poor image quality path when evidence is weak",
  },
  {
    key: "variants",
    title: "[Demo] Multi-Color Sneaker",
    productType: "Shoe",
    color: "Red",
    hasImage: true,
    expected: "Multi-variant banner — primary color option only today",
  },
] as const;

console.log("Sellenvo Vision — demo catalog story");
console.log("====================================");
for (const d of DEMO_CATALOG) {
  console.log(`  [${d.key}] ${d.title}`);
  console.log(`      expected: ${d.expected}`);
}
console.log(`
Setup path:
  npm install
  npm run setup
  npm run demo:seed   # this printout / contract
  npm run dev         # then Catalog Health → Demo tools → Seed demo catalog

Creating live Shopify products requires an authenticated Admin session
(shopify app dev). Use the in-app Seed button — no GraphiQL required.
`);
