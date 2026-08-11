/**
 * Prove Settings toggles change real behavior:
 *  - autoScanOnCreate → products/create enqueue gate
 *  - safeAutoFixEnabled → color may auto-apply; others stay confirm
 *  - showExperimentalAttributes → pattern/finish in analysis + policy
 *
 * Run: npx tsx scripts/test-settings-effects.ts
 */
import {
  evaluateFixPolicy,
  isSafeAutoFix,
  getAttribute,
} from "../app/lib/attributes";
import { buildAnalysisResultV2 } from "../app/lib/consistency.server";
import type { ListingFacts, VisualFacts } from "../app/lib/types";
import {
  getShopSettings,
  upsertShopSettings,
  shouldAutoScanOnCreate,
  toFixSettings,
} from "../app/lib/shop-settings.server";
import db from "../app/db.server";

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

const baseListing: ListingFacts = {
  productTitle: "Striped Cotton Tee",
  productType: "T-Shirt",
  claimedColor: "blue",
  claimedMaterial: "cotton",
  claimedPattern: "solid",
  claimedFinish: "matte",
  materialSource: "metafield",
};

const baseVisual: VisualFacts = {
  visionColor: "red",
  visionConfidence: 0.92,
  visionReasoning: "Bright red tee",
  visionProductType: "t-shirt",
  visionProductTypeConfidence: 0.9,
  visionMaterial: "cotton",
  visionMaterialConfidence: 0.88,
  visionPattern: "striped",
  visionPatternConfidence: 0.86,
  visionFinish: "matte",
  visionFinishConfidence: 0.84,
  imageQuality: "good",
};

console.log("\n=== Registry: color is safe-eligible ===");
assert(getAttribute("color")?.fixPolicy === "safe", "color fixPolicy=safe");
assert(getAttribute("material")?.fixPolicy === "confirm", "material confirm");
assert(getAttribute("pattern")?.status === "EXPERIMENTAL", "pattern experimental");

console.log("\n=== Setting: safeAutoFixEnabled ===");
{
  const off = {
    safeAutoFixEnabled: false,
    materialWriteMode: "metafield" as const,
    showExperimentalAttributes: false,
  };
  const on = { ...off, safeAutoFixEnabled: true };

  const colorOff = evaluateFixPolicy("color", off, {
    observation: "observed",
    confidence: 0.95,
  });
  assert(colorOff.allowed === true, "color allowed when safeAutoFix off");
  assert(
    colorOff.requiresConfirmation === true,
    "color requires confirmation when safeAutoFix off",
  );
  assert(isSafeAutoFix("color", off) === false, "isSafeAutoFix color=false when off");

  const colorOn = evaluateFixPolicy("color", on, {
    observation: "observed",
    confidence: 0.95,
  });
  assert(
    colorOn.requiresConfirmation === false,
    "color does NOT require confirmation when safeAutoFix on",
  );
  assert(isSafeAutoFix("color", on) === true, "isSafeAutoFix color=true when on");

  assert(
    isSafeAutoFix("productType", on) === false,
    "productType never auto-safe",
  );
  assert(isSafeAutoFix("material", on) === false, "material never auto-safe");
  assert(
    evaluateFixPolicy("color", on, { observation: "inferred", confidence: 0.99 })
      .requiresConfirmation === true,
    "inferred color still requires confirm even if safeAutoFix on",
  );
}

console.log("\n=== Setting: showExperimentalAttributes ===");
{
  const off = {
    safeAutoFixEnabled: false,
    materialWriteMode: "metafield" as const,
    showExperimentalAttributes: false,
  };
  const on = { ...off, showExperimentalAttributes: true };

  assert(
    evaluateFixPolicy("pattern", off).allowed === false,
    "pattern blocked when experimental off",
  );
  assert(
    evaluateFixPolicy("finish", off).allowed === false,
    "finish blocked when experimental off",
  );
  assert(
    evaluateFixPolicy("pattern", on).allowed === true,
    "pattern allowed when experimental on",
  );
  assert(
    evaluateFixPolicy("finish", on).allowed === true,
    "finish allowed when experimental on",
  );
  assert(
    evaluateFixPolicy("pattern", on).requiresConfirmation === true,
    "pattern still confirm-only when experimental on",
  );

  const analysisOff = buildAnalysisResultV2({
    listing: baseListing,
    visual: baseVisual,
    imageUrl: "https://cdn.shopify.com/test.jpg",
    productId: "gid://shopify/Product/1",
    includeExperimental: false,
  });
  const analysisOn = buildAnalysisResultV2({
    listing: baseListing,
    visual: baseVisual,
    imageUrl: "https://cdn.shopify.com/test.jpg",
    productId: "gid://shopify/Product/1",
    includeExperimental: true,
  });

  assert(
    !analysisOff.signalResults.some((s) => s.signal === "pattern"),
    "analysis omits pattern when experimental off",
  );
  assert(
    !analysisOff.signalResults.some((s) => s.signal === "finish"),
    "analysis omits finish when experimental off",
  );
  assert(
    analysisOn.signalResults.some((s) => s.signal === "pattern"),
    "analysis includes pattern when experimental on",
  );
  assert(
    analysisOn.signalResults.some((s) => s.signal === "finish"),
    "analysis includes finish when experimental on",
  );
  assert(
    analysisOn.suggestedFixes.some((f) => f.field === "pattern"),
    "pattern fix suggested when experimental on + mismatch",
  );
}

console.log("\n=== Setting: autoScanOnCreate (pure gate) ===");
assert(
  shouldAutoScanOnCreate({ autoScanOnCreate: true }) === true,
  "enqueue when autoScanOnCreate=true",
);
assert(
  shouldAutoScanOnCreate({ autoScanOnCreate: false }) === false,
  "skip enqueue when autoScanOnCreate=false",
);

console.log("\n=== Setting: DB persist round-trip ===");
{
  const shop = `settings-test-${Date.now()}.myshopify.com`;
  try {
    const defaults = await getShopSettings(shop);
    assert(defaults.autoScanOnCreate === true, "default autoScanOnCreate=true");
    assert(defaults.safeAutoFixEnabled === false, "default safeAutoFix=false");
    assert(
      defaults.showExperimentalAttributes === false,
      "default experimental=false",
    );

    const saved = await upsertShopSettings(shop, {
      autoScanOnCreate: false,
      safeAutoFixEnabled: true,
      showExperimentalAttributes: true,
    });
    assert(saved.autoScanOnCreate === false, "upsert autoScanOnCreate=false");
    assert(saved.safeAutoFixEnabled === true, "upsert safeAutoFix=true");
    assert(
      saved.showExperimentalAttributes === true,
      "upsert experimental=true",
    );

    const reloaded = await getShopSettings(shop);
    assert(reloaded.autoScanOnCreate === false, "reload autoScanOnCreate");
    assert(reloaded.safeAutoFixEnabled === true, "reload safeAutoFix");
    assert(
      reloaded.showExperimentalAttributes === true,
      "reload experimental",
    );

    const fix = toFixSettings(reloaded);
    assert(isSafeAutoFix("color", fix) === true, "toFixSettings → color safe");
    assert(
      evaluateFixPolicy("pattern", fix).allowed === true,
      "toFixSettings → pattern allowed",
    );
    assert(
      shouldAutoScanOnCreate(reloaded) === false,
      "reloaded settings skip auto-scan",
    );

    // Flip back and prove auto-scan gate flips
    const flipped = await upsertShopSettings(shop, {
      autoScanOnCreate: true,
      safeAutoFixEnabled: false,
      showExperimentalAttributes: false,
    });
    assert(shouldAutoScanOnCreate(flipped) === true, "flipped → auto-scan on");
    assert(
      isSafeAutoFix("color", toFixSettings(flipped)) === false,
      "flipped → color not auto-safe",
    );
    assert(
      evaluateFixPolicy("pattern", toFixSettings(flipped)).allowed === false,
      "flipped → pattern blocked",
    );
  } finally {
    await db.shopSettings.deleteMany({ where: { shop } }).catch(() => {});
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
