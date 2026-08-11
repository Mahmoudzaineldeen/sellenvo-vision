# Performance & UX Pass Report

## Performance map (before → after)

| Operation | Before (architecture) | After | Notes |
|-----------|----------------------|-------|-------|
| **Apply Fix** | mutate → verify → `runListingRecheck` (metafields+settings+persist) → on cache miss **full vision** | mutate → verify → **targeted recheck** (cached vision only) → **never** vision on mutation path | Highest impact |
| Fresh analysis | download once → vision → pixel → consistency | unchanged + URL-prefer vision + 60s timeout | Vision remains dominant cost |
| Cached recheck | vision skipped | same + parallel metafields/settings | |
| Inbox load | products then health then analyses (serial); over-fetch `take*5` | **Promise.all**; SQL latest-per-product; page size 25 | Persist-first; no analyze on render |
| Apply All | same as Apply Fix path | same targeted recheck; parallel audits | Partial failure unchanged |
| Audit writes | sequential `await` loop | `Promise.all` | |
| Shopify verify | product then metafields serial | **parallel** | |
| Metafield writes | sequential | **parallel** | |

## AI / Shopify call counts (Apply Fix success path)

| | Before | After |
|--|-------:|------:|
| Vision / Groq | 0 (cache hit) or **1+** (cache miss fallback) | **0** always |
| Image download | 0 or 1 | **0** |
| Shopify mutate | 1–2 | 1–2 |
| Shopify verify product | 1 | 1 |
| Shopify metafields | 1–2 | 0–1 (reuse verify result) |
| DB persist | 1 | 1 |

## Largest remaining bottleneck

**Groq vision latency** on *first* analyze for a new image (typically 5–25s with URL-first path). Mitigations shipped:

- HTTPS URL vision starts **in parallel** with local image download (no download-before-model)
- Fewer strategies + tighter timeouts (25s URL / 40s data-URI fallback)
- Guardian **loader restores** last analysis for the same image → open is instant
- Default Analyze uses memory/DB vision cache; **Re-analyze** (`forceFull`) hits Groq
- Apply Fix never blocks on vision

Fresh vision remains model-bound (qwen3.6-27b is Groq’s current multimodal option).

## UX improvements

- Catalog Health: “What needs my attention?” + attribute counts + Review CTA + High/Medium/Low
- Server-side filter + pagination (25/page)
- Guardian signals: Shopify says / Vision detected / Evidence / confidence bands (no raw %)
- Apply Fix: Updating… → Verifying…; mutation path never blocks on vision
- Bulk scan toast: queued, non-blocking
- Scan catalog button disables while queueing (dedupe)

## Safety preserved

- Shopify verification still mandatory before success
- No optimistic “success” before verify
- FixPolicy still server-side
- Audit events still recorded
- SSRF / secrets unchanged

## Verdict

**PILOT READY**

Apply Fix perceived performance and Inbox architecture are production-shaped; App Store readiness still blocked on real-image FAFR and live-shop E2E evidence.
