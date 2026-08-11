/**
 * Force-load Groq keys from project .env so they win over a stale Windows /
 * shell GROQ_API_KEY that is already rate-limited. dotenv default does not override.
 *
 * Re-reads on each call when the file mtime changes (so key swaps apply after
 * save without relying on a full cold start in every case).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const GROQ_ENV_KEYS = [
  "GROQ_API_KEY",
  "GROQ_API_KEY_FALLBACK",
  "GROQ_API_KEYS",
] as const;

let lastMtimeMs = -1;

/** @returns true when .env was re-read (mtime changed). */
export function loadGroqEnvFromDotenvFile(): boolean {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return false;

  let mtimeMs = 0;
  try {
    mtimeMs = statSync(envPath).mtimeMs;
  } catch {
    return false;
  }

  if (mtimeMs === lastMtimeMs) return false;
  lastMtimeMs = mtimeMs;

  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return false;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!GROQ_ENV_KEYS.includes(name as (typeof GROQ_ENV_KEYS)[number])) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Always apply non-empty .env Groq values (override shell).
    // Empty GROQ_API_KEY= clears a stale shell key so FALLBACK can become primary.
    if (value) {
      process.env[name] = value;
    } else if (name === "GROQ_API_KEY") {
      delete process.env.GROQ_API_KEY;
    } else if (name === "GROQ_API_KEY_FALLBACK") {
      delete process.env.GROQ_API_KEY_FALLBACK;
    }
  }

  return true;
}
