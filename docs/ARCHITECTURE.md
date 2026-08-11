# Architecture — Sellenvo Vision Catalog Integrity

## Purpose

Compare Shopify listing claims (color option, product type, material metafield/title) against visual evidence from a product image. Suggest merchant-confirmed Admin API fixes. Never mutate Shopify from AI output alone.

## High-level flow

```text
Shopify Product
  → extract listing facts
  → download image (once, SSRF-safe)
  → VisionProvider (Groq primary → optional OpenRouter)
  → Zod-validate AI response
  → consistency engine (deterministic)
  → persist Analysis + SuggestedFix[]
  → Catalog Health / Guardian UI
  → merchant confirms
  → Shopify mutation + verify
  → audit event + listing-only recheck (cached vision)
```

## Layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Routes | `app/routes/app.*` | Auth, intents, merchant UI |
| Attribute registry | `app/lib/attributes/` | Single source of truth for attributes, policy, packs |
| Analysis pipeline | `app/lib/analysis-pipeline.server.ts` | Orchestrate fetch → vision → consistency → persist |
| Vision providers | `app/lib/vision/` | Groq + OpenRouter abstraction |
| Vision (Groq impl) | `app/lib/vision.server.ts` | Multimodal calls, timeouts, sanitization |
| Pixel (optional) | `app/lib/color-analysis.server.ts` | Dominant color via ColorThief (Sharp not used at runtime) |
| Consistency engine | `app/lib/consistency.server.ts` | MATCH / MISMATCH / UNCERTAIN / NOT_DETECTABLE / NOT_APPLICABLE |
| Mutations | `app/lib/shopify-fixes.server.ts` | Option/metafield/title writes + verify |
| Jobs | `app/lib/jobs.server.ts` | DB-backed poller, retries, stale recovery, per-shop limits |
| Cache | `app/lib/vision-cache.server.ts` | In-memory LRU (max 500), TTL 30m |
| Persistence | `app/lib/analysis-persist.server.ts` | Analysis, audit, retention purge |
| SSRF | `app/lib/ssrf.server.ts` | HTTPS-only image fetch protections |

## Material storage (ADR)

Default write mode is **metafield** (`sellenvo.material`):

1. **Read:** metafield first, then whole-word title keyword fallback
2. **Write:** metafield by default; title rewrite only when `materialWriteMode` is `title` or `both`
3. Title rewrite is never silent — merchant settings + UI copy make the target explicit

## Persistence (Prisma SQLite)

Models: `Session`, `Analysis`, `ScanJob`, `AuditEvent`, `ShopSettings`, `VisionFeedback`.

Single-instance pilot. PostgreSQL is the documented path for multi-instance scale.

## Auth & tenancy

- Every `/app/*` route uses `authenticate.admin(request)`
- Webhooks use `authenticate.webhook(request)`
- Background jobs use `unauthenticated.admin(shop)` offline sessions

## Known limitations

- Only the **first** Color option value is compared / updated (UI warns when multiple exist)
- Vision cache and mutation rate limits are **process-local**
- Pattern / Finish remain EXPERIMENTAL until evaluation evidence
- Deterministic unit tests do **not** prove vision accuracy
