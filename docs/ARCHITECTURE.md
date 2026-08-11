# Architecture — Visual Listing Guardian V2

## Purpose

Compare Shopify listing claims (color option, product type, material word in title) against visual evidence from a product image. Suggest merchant-confirmed Admin API fixes. Never mutate Shopify from AI output alone.

## High-level flow

```text
Shopify Product
  → extract listing facts
  → download image (once)
  → Groq vision + optional pixel color
  → Zod-validate AI response
  → consistency engine (deterministic)
  → AnalysisResult + SuggestedFix[]
  → merchant confirms
  → Shopify mutation + verify
  → listing-only recheck (cached vision)
```

## Layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Routes | `app/routes/app.guardian.$productId.tsx`, `app._index.tsx` | Auth, intents, UI state, toasts |
| Analysis pipeline | `app/lib/analysis-pipeline.server.ts` | Orchestrate fetch → vision → consistency → cache |
| Vision | `app/lib/vision.server.ts` | Groq multimodal, timeouts, confidence clamp, material sanitize |
| Pixel (optional) | `app/lib/color-analysis.server.ts` | Dominant color via colorthief/sharp |
| Consistency engine | `app/lib/consistency.server.ts` | MATCH / MISMATCH / UNCERTAIN, health score, fix generation |
| Normalization | `color-normalize`, `product-type-normalize`, `materials` | Conservative aliases only |
| Mutations | `app/lib/shopify-fixes.server.ts` | `productOptionUpdate` + `productUpdate`, verify |
| Cache | `app/lib/vision-cache.server.ts` | In-memory LRU (max 500), TTL 30m, keyed by product+image URL |
| Rate limit | `app/lib/mutation-rate-limit.server.ts` | 5 mutations / 60s / product |
| Logging | `app/lib/logger.server.ts` | Structured JSON; secrets redacted |

## Domain distinctions

| Concept | Meaning |
|---------|---------|
| AI prediction | `VisualFacts` from Groq / pixel |
| Confidence | Model self-report blended with pixel (color only); clamped ≤ 0.95 |
| Consistency decision | `Verdict` per signal + overall |
| Suggested fix | Merchant-facing proposal gated by confidence + quality |
| Applied mutation | Shopify write + post-verify |

## Material storage (ADR)

Shopify Product has **no dedicated material field**. This app:

1. Extracts claimed material from the **product title** via whole-word keywords
2. Applies material fixes by **rewriting the title** material token
3. Warns the merchant in the UI that the title will change

Alternatives considered: metafields (cleaner, not visible in default listing), tags (unstructured). Title rewrite matches the current product model and demo UX.

## Auth & tenancy

- Every `/app/*` route uses `authenticate.admin(request)`
- Admin GraphQL client is store-scoped by Shopify OAuth
- Prisma SQLite stores **sessions only** (access tokens) — no analysis persistence

## Known limitations

- Only the **first** Color option value is compared / updated
- Vision cache is **process-local** (not shared across workers)
- Multi-product images, models wearing products, and lighting bias remain AI failure modes
- Deterministic unit tests do **not** prove vision accuracy
