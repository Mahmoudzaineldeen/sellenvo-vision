/**
 * Optional Groq vision smoke test.
 * Requires GROQ_API_KEY in env.
 *
 *   set GROQ_API_KEY=gsk_...
 *   npx tsx scripts/test-vision-smoke.ts
 *
 * Uses a public Wikimedia black leather wallet-ish image.
 */
import { analyzeProductImage } from "../app/lib/vision.server";

const SAMPLE_IMAGE =
  process.env.TEST_IMAGE_URL ||
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Black_leather_wallet.jpg/640px-Black_leather_wallet.jpg";

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("Set GROQ_API_KEY first (https://console.groq.com)");
    process.exit(1);
  }

  console.log("Analyzing:", SAMPLE_IMAGE);
  try {
    const result = await analyzeProductImage(SAMPLE_IMAGE);
    console.log(JSON.stringify(result, null, 2));
    console.log(
      "\nDerived confidence (model):",
      Math.round(result.colorConfidence * 100) + "%",
    );
  } catch (err) {
    console.error("Vision smoke test failed:", err);
    console.error(
      "If the sample URL 404s, set TEST_IMAGE_URL to any public product image.",
    );
    process.exit(1);
  }
}

main();
