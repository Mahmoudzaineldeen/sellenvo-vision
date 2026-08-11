# Failure Modes & Troubleshooting

## User-facing failures

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| “GROQ_API_KEY is not set” | Missing env | Add key to `.env`, restart `shopify app dev` |
| Analysis timed out | Groq slow / network | Retry; check Groq status |
| Blank / placeholder image | No real media | Attach demo image or upload in Admin |
| Too many updates… | Rate limit (5/min/product) | Wait ~60s |
| Invalid fixes payload | Corrupt Apply All JSON | Re-analyze, apply again |
| Shopify product response failed schema validation | Unexpected Admin API shape | Check API version / product fields |
| Material fix failed: no claim in title | Title lacks keyword | Edit title to include material word, or skip material fix |
| Verification failed | Concurrent Admin edit | Re-analyze and retry |

## External dependency matrix

| Dependency | Down | Behavior |
|------------|------|----------|
| Groq | Unavailable | Analysis fails with error; no mutation |
| Shopify Admin API | Unavailable | Loader/action errors; toasts |
| Image CDN | Unreachable | Analysis fails on download |
| colorthief/sharp | Missing | Vision-only (logged warning) |

## Operational logs

Structured JSON via `logEvent` (`app/lib/logger.server.ts`):

- `analysis.full.completed` / `analysis.full.failed`
- `analysis.recheck.completed` / `analysis.recheck.failed`
- `mutation.completed` / `mutation.rate_limited` / `mutation.recheck`

Never logged: API keys, access tokens, data URIs.

## Cache invalidation

| Event | Action |
|-------|--------|
| Image attach / replace | `clearCachedVisual(productId)` |
| Image URL change | Cache miss (URL mismatch) |
| Listing-only fix | Cache **kept** → fast recheck |
| TTL 30 minutes | Entry expires |
| >500 entries | LRU eviction |

## Security notes

- Treat vision output as untrusted; consistency engine is authoritative for decisions
- `fixesJson` validated with Zod before mutation
- User-provided image URLs are fetched with timeout + size caps (SSRF blast radius limited)
- Product metadata is not passed into the vision prompt
