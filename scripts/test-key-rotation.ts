/**
 * Unit check: Groq keys round-robin instead of sticky-primary.
 * Run: npx tsx scripts/test-key-rotation.ts
 */
import {
  __advanceGroqKeyRoundRobinForTests,
  __peekGroqKeyOrderForTests,
  __resetGroqKeyRotationForTests,
} from "../app/lib/vision.server";
import { loadGroqEnvFromDotenvFile } from "../app/lib/load-groq-env.server";

loadGroqEnvFromDotenvFile();
__resetGroqKeyRotationForTests();

const first = __peekGroqKeyOrderForTests();
if (first.length < 2) {
  console.error(
    `FAIL: need ≥2 Groq keys in .env to verify rotation (found ${first.length})`,
  );
  process.exit(1);
}

const starts: string[] = [];
for (let i = 0; i < first.length; i++) {
  const order = __peekGroqKeyOrderForTests();
  starts.push(order[0]);
  __advanceGroqKeyRoundRobinForTests();
}

const uniqueStarts = new Set(starts);
if (uniqueStarts.size !== first.length) {
  console.error(
    `FAIL: expected ${first.length} different starting keys across rotation, got ${uniqueStarts.size}`,
    starts,
  );
  process.exit(1);
}

console.log(
  `OK: round-robin cycles ${first.length} keys — start order fingerprints:`,
);
for (let i = 0; i < starts.length; i++) {
  console.log(`  request ${i + 1} starts with ${starts[i]}`);
}
process.exit(0);
