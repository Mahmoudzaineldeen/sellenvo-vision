/**
 * Smoke-test Groq keys from .env (no secrets printed).
 * Usage: npx tsx scripts/test-groq-keys.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Groq from "groq-sdk";
import sharp from "sharp";

const ENV_PATH = resolve(process.cwd(), ".env");

function loadGroqFromEnvFile(): void {
  if (!existsSync(ENV_PATH)) {
    console.error("FAIL: .env not found");
    process.exit(1);
  }
  const text = readFileSync(ENV_PATH, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (
      name !== "GROQ_API_KEY" &&
      name !== "GROQ_API_KEY_FALLBACK" &&
      name !== "GROQ_API_KEYS"
    ) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env[name] = value;
    else delete process.env[name];
  }
}

function collectKeys(): Array<{ label: string; key: string }> {
  const out: Array<{ label: string; key: string }> = [];
  const seen = new Set<string>();
  const push = (label: string, key: string | undefined) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ label, key });
  };
  push("primary", process.env.GROQ_API_KEY);
  push("fallback", process.env.GROQ_API_KEY_FALLBACK);
  for (const k of (process.env.GROQ_API_KEYS || "").split(",")) {
    push("list", k.trim());
  }
  return out;
}

function redact(msg: string): string {
  return msg.replace(/gsk_[A-Za-z0-9]+/g, "[redacted]").slice(0, 280);
}

async function sampleImageDataUri(): Promise<string> {
  if (process.env.TEST_IMAGE_URL) return process.env.TEST_IMAGE_URL;
  const buf = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function testText(label: string, key: string): Promise<boolean> {
  const groq = new Groq({ apiKey: key });
  try {
    const r = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: 'Reply with exactly: {"ok":true}' }],
      max_completion_tokens: 32,
      temperature: 0,
    });
    const text = r.choices?.[0]?.message?.content ?? "";
    console.log(`  text   [${label}]: OK (${text.replace(/\s+/g, " ").slice(0, 40)})`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = /rate_limit|429|tokens per day/i.test(msg)
      ? "RATE_LIMIT"
      : /401|403|invalid/i.test(msg)
        ? "AUTH"
        : "FAIL";
    console.log(`  text   [${label}]: ${kind} — ${redact(msg)}`);
    return false;
  }
}

async function testVision(
  label: string,
  key: string,
  imageRef: string,
): Promise<boolean> {
  const groq = new Groq({ apiKey: key });
  try {
    const r = await groq.chat.completions.create({
      model: "qwen/qwen3.6-27b",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Look at the image. Reply ONLY JSON: {"primaryColor":"string","ok":true}',
            },
            { type: "image_url", image_url: { url: imageRef } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 64,
      temperature: 0,
      reasoning_effort: "none",
      stream: false,
    });
    const text = r.choices?.[0]?.message?.content ?? "";
    console.log(`  vision [${label}]: OK (${text.replace(/\s+/g, " ").slice(0, 80)})`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = /rate_limit|429|tokens per day/i.test(msg)
      ? "RATE_LIMIT"
      : /401|403|invalid.*api.?key/i.test(msg)
        ? "AUTH"
        : "FAIL";
    console.log(`  vision [${label}]: ${kind} — ${redact(msg)}`);
    return false;
  }
}

async function main() {
  loadGroqFromEnvFile();
  const keys = collectKeys();
  console.log(`Groq key smoke test — ${keys.length} key(s) from .env`);
  if (keys.length === 0) {
    console.error("FAIL: no GROQ_API_KEY / FALLBACK in .env");
    process.exit(1);
  }

  const imageRef = await sampleImageDataUri();
  console.log(`image: ${imageRef.startsWith("data:") ? "generated 64x64 png data-uri" : "TEST_IMAGE_URL"}`);

  let anyVisionOk = false;
  let primaryVisionOk = false;

  for (const { label, key } of keys) {
    console.log(`\n[${label}] ending …${key.slice(-4)}`);
    await testText(label, key);
    const visionOk = await testVision(label, key, imageRef);
    if (visionOk) anyVisionOk = true;
    if (label === "primary" && visionOk) primaryVisionOk = true;
  }

  console.log("\n---");
  if (primaryVisionOk) {
    console.log("PASS: primary key vision works — restart shopify app dev and analyze.");
    process.exit(0);
  }
  if (anyVisionOk) {
    console.log(
      "PARTIAL: fallback vision works but primary failed — app should fail over.",
    );
    process.exit(0);
  }
  console.log("FAIL: no key passed vision. Check quota / account / model access.");
  process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", redact(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
