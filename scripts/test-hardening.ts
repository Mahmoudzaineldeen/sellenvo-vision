/**
 * Hardening tests: provider fallback, analysis contract cache keys, SSRF edges.
 * Run: npx tsx scripts/test-hardening.ts
 */

import assert from "node:assert/strict";
import {
  analyzeWithProviders,
  registerSecondaryVisionProvider,
  type VisionAnalyzeResult,
  type VisionProvider,
} from "../app/lib/vision/index";
import { visionAnalysisContract } from "../app/lib/vision-analysis-contract";
import {
  clearAllVisualCaches,
  getCachedVisual,
  setCachedVisual,
} from "../app/lib/vision-cache.server";
import { assertSafeImageUrl, isPrivateIp } from "../app/lib/ssrf.server";

let passed = 0;
function ok(cond: boolean, msg: string) {
  assert.equal(cond, true, msg);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

async function testProviderFallback() {
  console.log("\nProvider fallback");

  const mockSecondary: VisionProvider = {
    id: "openrouter",
    displayName: "Mock OpenRouter",
    isAvailable: () => true,
    async analyze(): Promise<VisionAnalyzeResult> {
      return {
        providerId: "openrouter",
        latencyMs: 1,
        response: {
          primaryColor: "black",
          colorConfidence: 0.9,
          productType: "wallet",
          productTypeConfidence: 0.9,
          material: "leather",
          materialConfidence: 0.9,
          imageQuality: "good",
          reasoning: "mock",
        },
      };
    },
  };

  const prev = {
    primary: process.env.VISION_PRIMARY_PROVIDER,
    fallback: process.env.VISION_FALLBACK_PROVIDER,
    groq: process.env.GROQ_API_KEY,
    groqList: process.env.GROQ_API_KEYS,
    groqFb: process.env.GROQ_API_KEY_FALLBACK,
    or: process.env.OPENROUTER_API_KEY,
  };

  try {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_API_KEY_FALLBACK;
    delete process.env.OPENROUTER_API_KEY;
    process.env.VISION_PRIMARY_PROVIDER = "groq";
    process.env.VISION_FALLBACK_PROVIDER = "openrouter";
    registerSecondaryVisionProvider(() => mockSecondary);

    const result = await analyzeWithProviders({
      imageUrl: "https://cdn.shopify.com/example.jpg",
    });
    ok(
      result.providerId === "openrouter",
      "falls back when primary unavailable",
    );
  } finally {
    registerSecondaryVisionProvider(null);
    const restore = (
      key: string,
      value: string | undefined,
    ) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("VISION_PRIMARY_PROVIDER", prev.primary);
    restore("VISION_FALLBACK_PROVIDER", prev.fallback);
    restore("GROQ_API_KEY", prev.groq);
    restore("GROQ_API_KEYS", prev.groqList);
    restore("GROQ_API_KEY_FALLBACK", prev.groqFb);
    restore("OPENROUTER_API_KEY", prev.or);
  }
}

function testAnalysisContractCache() {
  console.log("\nAnalysis contract cache");
  clearAllVisualCaches();
  const productId = "gid://shopify/Product/contract-1";
  const image = "https://cdn.example.com/a.jpg";
  const visual = {
    visionColor: "black",
    visionConfidence: 0.9,
    visionProductType: "wallet",
    visionProductTypeConfidence: 0.9,
    visionMaterial: "leather",
    visionMaterialConfidence: 0.9,
    visionReasoning: "test",
    imageQuality: "good" as const,
  };

  const core = visionAnalysisContract({ includeExperimental: false });
  const exp = visionAnalysisContract({
    includeExperimental: true,
    productType: "T-Shirt",
  });
  ok(core !== exp, "contract changes when packs/experimental change");

  setCachedVisual(productId, image, visual, core);
  ok(
    getCachedVisual(productId, image, core)?.visionColor === "black",
    "cache hit for matching contract",
  );
  ok(
    getCachedVisual(productId, image, exp) === null,
    "cache miss when contract changes",
  );
  clearAllVisualCaches();
}

async function testSsrfEdges() {
  console.log("\nSSRF edges");
  ok(isPrivateIp("127.0.0.1"), "loopback IPv4 private");
  ok(isPrivateIp("10.0.0.1"), "10/8 private");
  ok(isPrivateIp("192.168.1.1"), "192.168/16 private");
  ok(isPrivateIp("169.254.169.254"), "link-local / metadata");
  ok(!isPrivateIp("8.8.8.8"), "public IP allowed");

  await assert.rejects(() => assertSafeImageUrl("http://example.com/a.jpg"));
  ok(true, "rejects http");
  await assert.rejects(() => assertSafeImageUrl("https://localhost/a.jpg"));
  ok(true, "rejects localhost");
  await assert.rejects(() =>
    assertSafeImageUrl("https://user:pass@example.com/a.jpg"),
  );
  ok(true, "rejects URL credentials");
}

async function main() {
  console.log("=== Hardening tests ===");
  await testProviderFallback();
  testAnalysisContractCache();
  await testSsrfEdges();
  console.log(`\n${passed} assertions passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
