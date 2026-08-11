# Engineering / Product Implementation Report — Sellenvo Vision

**Date:** 2026-08-11  
**Readiness label:** **PILOT READY**

---

## 1. Executive summary

Sellenvo Vision already had a solid Catalog Integrity foundation (registry, verdicts, SSRF, mutation verification, Catalog Health, jobs). This implementation closed the remaining pilot gaps: retention enforcement, audit identity, GDPR webhooks, VisionProvider abstraction + OpenRouter fallback, Apply All two-mode UX, before/after fix previews, multi-variant honesty, revert-with-validation, job controls, cursor pagination, demo catalog seeding, privacy docs, and product-first README — without rewriting working systems.

---

## 2. Architecture before / after

| Area | Before | After |
|------|--------|-------|
| Vision | Direct Groq calls | `VisionProvider` → Groq primary, OpenRouter secondary |
| Retention | `purgeExpiredShopData` unused | Boot + daily purge |
| Audit | `userId: null` | Session / online user captured |
| GDPR | Uninstall only | + customers data_request/redact + shop/redact |
| Apply All | Flat confirm all | Safe mode + checkbox selection |
| Material UX | Always said “title” | Reflects `materialWriteMode` |
| Jobs | Basic poller | Stale recovery, pause/cancel, per-shop limit |
| Analysis schema | No variant field | Optional `variantId` for future multi-variant |
| Docs | Engineering-first README; stale SQLite claim | Product-first README + PRIVACY.md + corrected ARCHITECTURE |

---

## 3. Key file changes

**New:** `app/lib/vision/*`, GDPR webhook routes, `PRIVACY.md`, `scripts/seed-demo-catalog.ts`, `docs/eval-results.jsonl`, migration `analysis_variant_id`

**Updated:** `jobs.server.ts`, `analysis-pipeline.server.ts`, `analysis-persist.server.ts`, `FixModal.tsx`, `app.guardian.$productId.tsx`, `app._index.tsx`, `shopify.app.toml`, `README.md`, `docs/ARCHITECTURE.md`, Prisma schema

---

## 4–5. Attribute registry status

| Attribute | Status | Storage | Fix |
|-----------|--------|---------|-----|
| Color | PRODUCTION | Color option | safe (setting-gated) |
| Product type | PRODUCTION | productType | confirm |
| Material | PRODUCTION | sellenvo.material | confirm |
| Pattern | EXPERIMENTAL | sellenvo.pattern | confirm |
| Finish | EXPERIMENTAL | sellenvo.finish | confirm |

---

## 6–8. Mutation / audit / rollback

- Server `evaluateFixPolicy` remains authoritative
- Post-mutation Shopify verify unchanged
- Audit records old/new/success/userId/reason
- `intent=revert` restores prior value only if current Shopify state matches audited newValue (stale → block unless force)

---

## 9. Security

Preserved SSRF, prompt isolation, Zod, rate limits. Added GDPR compliance webhooks. Provider fallback logs switches without secrets.

---

## 10–14. Performance

**Instrumentation added** (not micro-optimized guesses):

- `route.catalog.loader` — parallelMs, product/analysis/job counts, healthLoadMs
- `route.guardian.loader` — shopifyMs, dbMs, cacheHit
- `analysis.vision.completed` — providerId + latency

**Improvements shipped:**

- Catalog Shopify list: cursor pagination (25/page) instead of hard-coded 50-only dump
- Guardian still paints from persisted analysis (no Groq on open)
- Vision still cached by image; mutation path still skips vision
- Job per-shop concurrency = 1; global = 2

Baseline numbers require a live `shopify app dev` session; logs emit on each loader hit.

---

## 15. UX changes

- Catalog Health empty/healthy/scanning banners
- Demo tools section (below inbox) with Seed demo catalog
- Apply All Safe Fixes vs Review & apply selected (checkboxes)
- Before/after + color swatches + material storage explanation
- Multi-variant “first color only” warning
- Job pause / resume / cancel queued

---

## 16–18. Tests executed

| Suite | Result |
|-------|--------|
| `test:consistency` | PASS (all V2 checks) |
| `test:registry` | 48 passed |
| `test:mutations` | 14 passed |
| `test:settings` | 38 passed |
| `tsc --noEmit` | PASS (after TS fixes) |
| `eslint` | PASS (after FixModal a11y fix) |
| `build` | PASS |
| `prisma migrate deploy` | PASS (variantId) |
| `eval-scorecard.ts` | Ran on internal sample JSONL |

---

## 19. Vision evaluation

`docs/eval-results.jsonl` is **internal evaluation / synthetic demo data** — not merchant truth. False Auto-Fix Rate reported by scorecard for color sample includes intentional false-fix example. Do not market as accuracy.

---

## 20–21. Scopes & privacy

Scopes: `read_products, write_products`. Privacy documented in `PRIVACY.md` (image-only to AI, retention, uninstall/GDPR).

---

## 22. Remaining limitations

- First Color option only (documented in UI)
- Process-local cache / rate limit
- OpenRouter unused unless key set
- No Playwright E2E in CI
- Revert UI button not yet surfaced in Guardian (server intent ready)
- Prisma generate may need restart if Windows DLL lock during live `shopify app dev`

---

## 23–24. Business metrics & merchant validation

No fabricated ROI/return metrics. Available: scan/analysis counts, audit success, health inbox aggregates, internal eval FAFR scaffold. Real merchant validation still required for Pattern/Finish promotion and App Store claims.

---

## 25. Next steps

1. Surface Revert control in Guardian mutation history UI
2. Collect real-image eval set; measure FAFR before enabling safe auto-fix in production shops
3. Optional: E2E Playwright for Analyze → Apply → Verify
4. Postgres + shared cache only when multi-instance is required

---

## Readiness

```text
PILOT READY
```

Justified by: working golden path preserved, mutation safety + audit + GDPR + retention, merchant-first Catalog Health, measured instrumentation, tests green, honest limitations, no unsupported accuracy/App Store claims.
