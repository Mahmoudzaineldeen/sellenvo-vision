# Engineering / Product Implementation Report — Sellenvo Vision

**Date:** 2026-08-11  
**Readiness label:** **PILOT READY**

---

## 1. Executive summary

Inspected the existing Catalog Integrity codebase against the production-hardening prompt. Most safety/UX architecture was already present. This pass closed remaining gaps without a rewrite: vision analysis-contract cache invalidation, configurable primary/fallback providers, Guardian **Restore previous** UI, merchant-safe evidence copy (no raw confidence %), hardening tests in CI, demo seed script, and honest docs (rollback, material storage).

---

## 2. File-by-file changes (this pass)

| File | Change | Reason | Risk |
|------|--------|--------|------|
| `app/lib/vision-analysis-contract.ts` | New contract key (prompt/pack version) | Prevent stale vision reuse | Low |
| `app/lib/vision-cache.server.ts` | Cache keyed by image + contract | Correctness | Low |
| `app/lib/vision/index.ts` | `VISION_PRIMARY/FALLBACK` + rate-limit fallback | Reliability | Medium |
| `app/lib/analysis-pipeline.server.ts` | Persist/hydrate with contract | Stale analysis prevention | Medium |
| `app/lib/analysis-persist.server.ts` | `analysisContract` + `listRecentSuccessfulAudits` | Freshness + revert UI | Low |
| `app/lib/post-fix-analysis.server.ts` | Contract-aware cache lookup | Post-fix correctness | Low |
| `app/lib/consistency.server.ts` | Evidence without raw % | Merchant trust | Low |
| `app/routes/app.guardian.$productId.tsx` | Recent changes + Restore UI | Rollback UX | Medium |
| `prisma/schema.prisma` + migration | `analysisContract` column | Persist contract | Low |
| `scripts/test-hardening.ts` | Provider/SSRF/contract tests | Regression safety | Low |
| `scripts/seed-demo-catalog.ts` | `npm run demo:seed` | Setup path | Low |
| `.github/workflows/ci.yml` | settings + hardening | CI coverage | Low |
| `docs/MUTATIONS.md`, README, AGENTS/CLAUDE | Honesty / less AI sprawl | Docs | Low |

---

## 3. Architecture

```text
Catalog Health → ScanJob queue → analysis pipeline
                         ↓
              VisionProvider (primary → fallback)
                         ↓
              VisualFacts + listing claims
                         ↓
              Deterministic consistency (MATCH/MISMATCH/UNCERTAIN/…)
                         ↓
              Persist Analysis + Catalog Health inbox
                         ↓
Guardian → Review evidence → Apply Fix / Manual Edit / Restore
                         ↓
              Shopify mutate → verify → AuditEvent (append-only)
```

SQLite + process-local cache/job poller remain **single-instance pilot** boundaries. Multi-worker needs Postgres + shared cache (not claimed ready).

---

## 4. Attribute table

| Attribute | Status | Detection | Storage | Fix policy | Evaluation |
|-----------|--------|-----------|---------|------------|------------|
| Color | PRODUCTION | Vision + pixel | Color option | safe (setting-gated) | Internal eval n=100 |
| Product type | PRODUCTION | Vision | productType | confirm | Internal eval n=100 |
| Material | PRODUCTION | Vision | sellenvo.material (default) | confirm | Internal eval n=100 |
| Pattern | EXPERIMENTAL | Vision (packs) | sellenvo.pattern | confirm | Internal eval only |
| Finish | EXPERIMENTAL | Vision (packs) | sellenvo.finish | confirm | Internal eval only |
| Sleeve/Neckline/Closure/Shoe/Strap | EXPERIMENTAL | Category packs | sellenvo.* | confirm | Internal eval only |

---

## 5. Performance

| Metric | Before | After | Notes |
|--------|--------|-------|-------|
| Guardian open (cached analysis) | DB paint, no Groq | Same + contract check | Invalidates on pack/prompt change |
| Vision cache hit | product+URL | product+URL+contract | Correctness > cache rate |
| Catalog list | Cursor page 25 | Unchanged this pass | Already paginated |
| Instrumentation | Structured logs | + provider.selected / fallback | Measure live via logs |

Live before/after wall times require a running `shopify app dev` session — not fabricated here.

---

## 6. Security

| Threat | Mitigation | Test | Result |
|--------|------------|------|--------|
| SSRF via image URL | HTTPS, DNS private IP, credentials block, size/timeout | `test:hardening` + registry | Pass |
| Client bypass of fix policy | Server `evaluateFixPolicy` | `test:mutations` | Pass |
| Secret leakage | Logger redaction; no keys in client | Code review | Preserved |
| GDPR | uninstall + customers/shop redact routes | Registered in toml | Present |

---

## 7. Reliability

- **Provider fallback:** `VISION_PRIMARY_PROVIDER` / `VISION_FALLBACK_PROVIDER`; Groq → OpenRouter when configured; no silent silent semantics change (same Zod schema)
- **Retry:** ScanJob attempts/maxAttempts; vision key rotation
- **Job recovery:** stale running → queued on poller boot
- **Mutation verification:** post-write Shopify re-fetch
- **Rollback:** audited restore with stale guard + confirm force

---

## 8. UX

- Catalog Health primary entry, empty/healthy banners, demo tools below fold
- Guardian: Analyze → evidence → Apply Fix / Edit / Apply all safe / Review & apply selected
- Recent changes → Restore previous (+ stale confirm)
- Partial bulk: “N of M fixes applied”
- Confidence badges remain High/Medium/Low (not “95% accurate”)

---

## 9. Testing

| Suite | Result |
|-------|--------|
| `prisma migrate deploy` (analysisContract) | PASS |
| `npm run test:hardening` | PASS (12 assertions) |
| `npm run test:consistency` | PASS (all V2 checks) |
| `npm run test:registry` | PASS (70) |
| `npm run test:mutations` | PASS (16) |
| `npm run test:settings` | PASS (38) |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |

`prisma generate` may fail with Windows DLL lock while `shopify app dev` holds the query engine — restart dev after migrate.

## 10. Remaining limitations

- First Color option only (UI banner when multi-variant)
- Process-local vision cache + rate limit + job poller (not multi-instance)
- OpenRouter inactive unless `OPENROUTER_API_KEY` set
- No Playwright E2E in CI
- Sharp is a dependency used by a key-test script, not the runtime color path (colorthief)
- Internal eval JSONL ≠ merchant field study; do not market FAFR as App Store proof

---

## 11. Next steps

1. Real-image labeled eval set before promoting experimental attrs or enabling safe auto-fix broadly
2. Optional Playwright golden path (Analyze → Apply → Verify → Restore)
3. Postgres + shared cache only when multi-instance is required

---

## 12. Readiness

**PILOT READY**
