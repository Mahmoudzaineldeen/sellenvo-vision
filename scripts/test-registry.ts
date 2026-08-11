/**
 * Attribute registry + verdict + policy + material dual-read tests.
 * Run: npx tsx scripts/test-registry.ts
 */

import {
  getAttribute,
  listProductionAttributes,
  listEnabledAttributes,
  evaluateFixPolicy,
  isSafeAutoFix,
  canPromoteToProduction,
  confidenceBand,
  resolveCategoryPack,
  selectAttributeKeysForProduct,
  normalizePatternName,
  patternsMatch,
  normalizeFinishName,
  finishesMatch,
  getEvaluationRecord,
} from "../app/lib/attributes";
import {
  evaluateConsistency,
  resolveClaimedMaterial,
  extractListingFacts,
  buildAnalysisResultV2,
} from "../app/lib/consistency.server";
import type { ListingFacts, VisualFacts } from "../app/lib/types";
import { isPrivateIp, assertSafeImageUrl } from "../app/lib/ssrf.server";

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

console.log("\n=== Attribute registry ===");
assert(getAttribute("color")?.status === "PRODUCTION", "color PRODUCTION");
assert(getAttribute("material")?.status === "PRODUCTION", "material PRODUCTION");
assert(getAttribute("pattern")?.status === "EXPERIMENTAL", "pattern EXPERIMENTAL");
assert(getAttribute("finish")?.status === "EXPERIMENTAL", "finish EXPERIMENTAL");
assert(listProductionAttributes().length === 3, "3 production attributes");
assert(
  listEnabledAttributes({ includeExperimental: true }).length === 5,
  "5 enabled with experimental",
);
assert(
  getAttribute("material")?.storage.kind === "metafield",
  "material storage metafield",
);

console.log("\n=== Evaluation gate ===");
assert(canPromoteToProduction("pattern").ok === false, "pattern cannot promote yet");
assert(canPromoteToProduction("finish").ok === false, "finish cannot promote yet");
assert(!!getEvaluationRecord("color"), "color has eval record");

console.log("\n=== Policy engine ===");
{
  const settings = {
    safeAutoFixEnabled: false,
    materialWriteMode: "metafield" as const,
    showExperimentalAttributes: false,
  };
  const color = evaluateFixPolicy("color", settings);
  assert(color.allowed && color.requiresConfirmation, "color requires confirm");
  assert(isSafeAutoFix("color", settings) === false, "safe auto-fix off");
  const pattern = evaluateFixPolicy("pattern", settings);
  assert(pattern.allowed === false, "pattern blocked when experimental off");
  const settingsExp = { ...settings, showExperimentalAttributes: true };
  assert(
    evaluateFixPolicy("pattern", settingsExp).allowed === true,
    "pattern allowed when experimental on",
  );
  const settingsSafe = { ...settings, safeAutoFixEnabled: true };
  assert(
    isSafeAutoFix("color", settingsSafe) === true,
    "color is safe auto-fix when shop setting enabled",
  );
  assert(
    isSafeAutoFix("material", settingsSafe) === false,
    "material stays confirm-only even when safeAutoFixEnabled",
  );
  assert(
    evaluateFixPolicy("color", settings).requiresConfirmation === true,
    "color still requires confirm when safeAutoFix disabled",
  );
}

console.log("\n=== Confidence bands ===");
assert(confidenceBand(0.95, "color") === "high", "high band");
assert(confidenceBand(0.6, "color") === "medium", "medium band");
assert(confidenceBand(0.3, "color") === "low", "low band");

console.log("\n=== Category packs ===");
assert(resolveCategoryPack("Apparel") === "apparel", "apparel pack");
assert(resolveCategoryPack("Shoe") === "footwear", "footwear pack");
assert(resolveCategoryPack("Handbag") === "bags", "bags pack");
assert(resolveCategoryPack("Necklace") === "jewelry", "jewelry pack");
assert(resolveCategoryPack(null) === "core", "core default");
assert(
  selectAttributeKeysForProduct({ productType: "Shirt" }).includes("color"),
  "apparel includes color",
);
assert(
  !selectAttributeKeysForProduct({ productType: "Shirt" }).includes("pattern"),
  "pattern excluded without experimental",
);
assert(
  selectAttributeKeysForProduct({
    productType: "Shirt",
    includeExperimental: true,
  }).includes("pattern"),
  "pattern included with experimental",
);

console.log("\n=== Pattern / Finish normalize ===");
assert(normalizePatternName("Stripes") === "striped", "stripe alias");
assert(patternsMatch("solid", "plain") === true, "plain≈solid");
assert(normalizeFinishName("shiny") === "glossy", "shiny→glossy");
assert(finishesMatch("matte", "dull") === true, "dull≈matte");

console.log("\n=== Material dual-read ===");
{
  const meta = resolveClaimedMaterial({
    title: "Red Cotton Shirt",
    metafieldValue: "leather",
  });
  assert(meta.claimedMaterial === "leather", "metafield preferred");
  assert(meta.materialSource === "metafield", "source metafield");

  const title = resolveClaimedMaterial({
    title: "Red Cotton Shirt",
    metafieldValue: null,
  });
  assert(title.claimedMaterial === "cotton", "title fallback");
  assert(title.materialSource === "title", "source title");

  const facts = extractListingFacts(
    {
      title: "Blue Shirt",
      productType: "Apparel",
      options: [{ name: "Color", optionValues: [{ name: "Blue" }] }],
    },
    { material: "denim" },
  );
  assert(facts.claimedMaterial === "denim", "extractListingFacts metafield");
  assert(facts.materialSource === "metafield", "extract source");
}

console.log("\n=== NOT_DETECTABLE never becomes MISMATCH ===");
{
  const listing: ListingFacts = {
    claimedColor: "Black",
    productTitle: "Black Leather Wallet",
    productType: null,
    claimedMaterial: "leather",
  };
  const visual: VisualFacts = {
    visionColor: "black",
    visionConfidence: 0.9,
    visionReasoning: "black wallet",
    visionProductType: "",
    visionProductTypeConfidence: 0,
    visionMaterial: "not_detectable",
    visionMaterialConfidence: 0.9,
    imageQuality: "good",
  };
  const { signalResults, issues } = evaluateConsistency(listing, visual);
  const mat = signalResults.find((s) => s.signal === "material");
  assert(mat?.verdict === "NOT_DETECTABLE", "material NOT_DETECTABLE");
  assert(
    !issues.some((i) => i.signal === "material"),
    "NOT_DETECTABLE not in issues",
  );
  assert(
    !issues.some((i) => i.verdict === "MISMATCH" && i.signal === "material"),
    "no material MISMATCH",
  );
}

console.log("\n=== Metafield-first material fix suggestion ===");
{
  const analysis = buildAnalysisResultV2({
    listing: {
      claimedColor: "Blue",
      productTitle: "Blue Cotton T-Shirt",
      productType: "Apparel",
      claimedMaterial: "cotton",
      materialSource: "title",
    },
    visual: {
      visionColor: "blue",
      visionConfidence: 0.9,
      visionReasoning: "blue shirt",
      visionProductType: "apparel",
      visionProductTypeConfidence: 0.9,
      visionMaterial: "denim",
      visionMaterialConfidence: 0.9,
      imageQuality: "good",
    },
    imageUrl: "https://cdn.shopify.com/test.jpg",
    productId: "gid://shopify/Product/1",
    materialWriteMode: "metafield",
  });
  assert(
    analysis.suggestedFixes.some((f) => f.field === "material"),
    "material fix suggested in metafield mode",
  );
}

console.log("\n=== SSRF helpers ===");
assert(isPrivateIp("127.0.0.1") === true, "localhost private");
assert(isPrivateIp("10.0.0.1") === true, "10/8 private");
assert(isPrivateIp("192.168.1.1") === true, "192.168 private");
assert(isPrivateIp("8.8.8.8") === false, "8.8.8.8 public");
{
  let blocked = false;
  try {
    await assertSafeImageUrl("http://example.com/a.jpg");
  } catch {
    blocked = true;
  }
  assert(blocked, "http blocked");
}
{
  let blocked = false;
  try {
    await assertSafeImageUrl("https://localhost/a.jpg");
  } catch {
    blocked = true;
  }
  assert(blocked, "localhost host blocked");
}

console.log(`\nRegistry tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
