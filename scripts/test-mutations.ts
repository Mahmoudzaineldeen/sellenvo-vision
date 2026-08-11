/**
 * Mocked Shopify mutation integration tests.
 * Run: npx tsx scripts/test-mutations.ts
 */

import {
  applyShopifyFixes,
  type AdminClient,
  type FixRequest,
} from "../app/lib/shopify-fixes.server";
import type { ShopFixSettings } from "../app/lib/attributes";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

type MockState = {
  title: string;
  productType: string | null;
  color: string;
  metafields: Record<string, string>;
  failNext?: string;
};

function createMockAdmin(state: MockState): AdminClient {
  return {
    async graphql(query: string, options?: { variables?: Record<string, unknown> }) {
      const q = query.replace(/\s+/g, " ");
      const vars = options?.variables ?? {};

      if (q.includes("GuardianGetProduct") || q.includes("query GuardianGetProduct")) {
        return jsonResponse({
          data: {
            product: {
              id: "gid://shopify/Product/1",
              title: state.title,
              productType: state.productType,
              options: [
                {
                  id: "gid://shopify/ProductOption/1",
                  name: "Color",
                  optionValues: [
                    {
                      id: "gid://shopify/ProductOptionValue/1",
                      name: state.color,
                    },
                  ],
                },
              ],
              featuredMedia: null,
              media: { nodes: [] },
            },
          },
        });
      }

      if (q.includes("SellenvoProductMetafields")) {
        return jsonResponse({
          data: {
            product: {
              material: state.metafields.material
                ? { value: state.metafields.material }
                : null,
              pattern: state.metafields.pattern
                ? { value: state.metafields.pattern }
                : null,
              finish: state.metafields.finish
                ? { value: state.metafields.finish }
                : null,
              sleeveType: state.metafields.sleeveType
                ? { value: state.metafields.sleeveType }
                : null,
              neckline: state.metafields.neckline
                ? { value: state.metafields.neckline }
                : null,
              closureType: state.metafields.closureType
                ? { value: state.metafields.closureType }
                : null,
              shoeStyle: state.metafields.shoeStyle
                ? { value: state.metafields.shoeStyle }
                : null,
              strapType: state.metafields.strapType
                ? { value: state.metafields.strapType }
                : null,
            },
          },
        });
      }

      if (q.includes("EnsureSellenvoMetafieldDefinition")) {
        return jsonResponse({
          data: {
            metafieldDefinitionCreate: {
              createdDefinition: { id: "def", namespace: "sellenvo", key: "x" },
              userErrors: [],
            },
          },
        });
      }

      if (q.includes("productOptionUpdate")) {
        if (state.failNext === "color") {
          return jsonResponse({
            data: {
              productOptionUpdate: {
                userErrors: [{ message: "color failed", code: "X" }],
                product: null,
              },
            },
          });
        }
        const updates = vars.optionValuesToUpdate as Array<{ name: string }>;
        state.color = updates[0]?.name ?? state.color;
        return jsonResponse({
          data: {
            productOptionUpdate: {
              userErrors: [],
              product: { id: "gid://shopify/Product/1" },
            },
          },
        });
      }

      if (q.includes("productUpdate")) {
        const product = vars.product as {
          productType?: string;
          title?: string;
        };
        if (product.productType) state.productType = product.productType;
        if (product.title) state.title = product.title;
        return jsonResponse({
          data: {
            productUpdate: {
              userErrors: [],
              product: {
                id: "gid://shopify/Product/1",
                title: state.title,
                productType: state.productType,
              },
            },
          },
        });
      }

      if (q.includes("metafieldsSet")) {
        const metafields = vars.metafields as Array<{
          key: string;
          value: string;
        }>;
        for (const m of metafields) {
          state.metafields[m.key] = m.value;
        }
        return jsonResponse({
          data: {
            metafieldsSet: {
              metafields: metafields.map((m) => ({
                id: "m",
                key: m.key,
                namespace: "sellenvo",
                value: m.value,
              })),
              userErrors: [],
            },
          },
        });
      }

      return jsonResponse({ data: {} });
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const confirmSettings: ShopFixSettings = {
  safeAutoFixEnabled: false,
  materialWriteMode: "metafield",
  showExperimentalAttributes: true,
};

console.log("\n=== Color mutation ===");
{
  const state: MockState = {
    title: "Red Wallet",
    productType: "Wallet",
    color: "Red",
    metafields: {},
  };
  const admin = createMockAdmin(state);
  const fixes: FixRequest[] = [
    {
      field: "color",
      newValue: "Black",
      currentValue: "Red",
      optionId: "gid://shopify/ProductOption/1",
      optionValueId: "gid://shopify/ProductOptionValue/1",
    },
  ];
  const { outcomes } = await applyShopifyFixes(admin, "gid://shopify/Product/1", fixes, {
    settings: confirmSettings,
    merchantConfirmed: true,
  });
  assert(outcomes[0]?.success === true, "color fix verified");
  assert(state.color === "Black", "color state updated");
}

console.log("\n=== Product type mutation ===");
{
  const state: MockState = {
    title: "Bag",
    productType: "Bag",
    color: "Black",
    metafields: {},
  };
  const admin = createMockAdmin(state);
  const { outcomes } = await applyShopifyFixes(
    admin,
    "gid://shopify/Product/1",
    [{ field: "productType", newValue: "Handbag", currentValue: "Bag" }],
    { settings: confirmSettings, merchantConfirmed: true },
  );
  assert(outcomes[0]?.success === true, "productType verified");
  assert(state.productType === "Handbag", "type updated");
}

console.log("\n=== Material metafield mutation ===");
{
  const state: MockState = {
    title: "Cotton Shirt",
    productType: "Apparel",
    color: "Blue",
    metafields: {},
  };
  const admin = createMockAdmin(state);
  const { outcomes } = await applyShopifyFixes(
    admin,
    "gid://shopify/Product/1",
    [{ field: "material", newValue: "Denim", currentValue: "Cotton" }],
    { settings: confirmSettings, merchantConfirmed: true },
  );
  assert(outcomes.some((o) => o.field === "material" && o.success), "material success");
  assert(state.metafields.material === "Denim", "metafield written");
  assert(state.title === "Cotton Shirt", "title unchanged (metafield mode)");
}

console.log("\n=== Pattern metafield ===");
{
  const state: MockState = {
    title: "Shirt",
    productType: "Apparel",
    color: "Blue",
    metafields: {},
  };
  const admin = createMockAdmin(state);
  const { outcomes } = await applyShopifyFixes(
    admin,
    "gid://shopify/Product/1",
    [{ field: "pattern", newValue: "Striped", currentValue: "Solid" }],
    { settings: confirmSettings, merchantConfirmed: true },
  );
  assert(outcomes.some((o) => o.field === "pattern" && o.success), "pattern success");
  assert(state.metafields.pattern === "Striped", "pattern metafield");
}

console.log("\n=== Sleeve type metafield ===");
{
  const state: MockState = {
    title: "Tee",
    productType: "Apparel",
    color: "Blue",
    metafields: {},
  };
  const admin = createMockAdmin(state);
  const { outcomes } = await applyShopifyFixes(
    admin,
    "gid://shopify/Product/1",
    [{ field: "sleeveType", newValue: "Short", currentValue: "Long" }],
    { settings: confirmSettings, merchantConfirmed: true },
  );
  assert(outcomes.some((o) => o.field === "sleeveType" && o.success), "sleeveType success");
  assert(state.metafields.sleeveType === "Short", "sleeveType metafield");
}

console.log("\n=== Policy blocks without confirmation ===");
{
  const state: MockState = {
    title: "X",
    productType: "X",
    color: "Red",
    metafields: {},
  };
  const admin = createMockAdmin(state);
  const { outcomes } = await applyShopifyFixes(
    admin,
    "gid://shopify/Product/1",
    [
      {
        field: "color",
        newValue: "Black",
        optionId: "gid://shopify/ProductOption/1",
        optionValueId: "gid://shopify/ProductOptionValue/1",
      },
    ],
    { settings: confirmSettings, merchantConfirmed: false },
  );
  assert(outcomes[0]?.success === false, "blocked without confirm");
  assert(state.color === "Red", "color unchanged");
}

console.log("\n=== Partial batch failure ===");
{
  const state: MockState = {
    title: "Red Wallet",
    productType: "Wallet",
    color: "Red",
    metafields: {},
    failNext: "color",
  };
  const admin = createMockAdmin(state);
  const { outcomes } = await applyShopifyFixes(
    admin,
    "gid://shopify/Product/1",
    [
      {
        field: "color",
        newValue: "Black",
        optionId: "gid://shopify/ProductOption/1",
        optionValueId: "gid://shopify/ProductOptionValue/1",
      },
      { field: "productType", newValue: "Accessory", currentValue: "Wallet" },
    ],
    { settings: confirmSettings, merchantConfirmed: true },
  );
  const colorOut = outcomes.find((o) => o.field === "color");
  const typeOut = outcomes.find((o) => o.field === "productType");
  assert(colorOut?.success === false, "color failed in batch");
  assert(typeOut?.success === true, "type succeeded in batch");
  assert(
    !(colorOut?.success && typeOut?.success),
    "batch not wholly successful",
  );
}

console.log(`\nMutation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
