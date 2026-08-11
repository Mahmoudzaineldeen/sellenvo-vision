# Engineering Report — Catalog Integrity Implementation

## 1. What changed

### New
- `app/lib/attributes/*` — registry, policy, evaluation gate, packs, confidence bands, pattern/finish normalizers
- `app/lib/ssrf.server.ts` — HTTPS-only, private-IP DNS check, redirect revalidation, size/timeout
- `app/lib/metafields.server.ts` — idempotent `sellenvo.*` definitions + read/write
- `app/lib/shop-settings.server.ts` — materialWriteMode, autoScan, safeAutoFix, experimental flag
- `app/lib/analysis-persist.server.ts` — Analysis/Audit/Feedback/uninstall cleanup
- `app/lib/jobs.server.ts` — DB-backed ScanJob poller (concurrency 2)
- `app/routes/app.settings.tsx` — merchant settings UI
- `app/routes/webhooks.products.create.tsx` / `update.tsx`
- `scripts/test-registry.ts`, `scripts/test-mutations.ts`, `scripts/eval-scorecard.ts`
- `docs/CATALOG_INTEGRITY.md`, eval FAFR notes
- Prisma models: Analysis, ScanJob, AuditEvent, ShopSettings, VisionFeedback

### Modified
- `types.ts` — extended Verdict + FixableSignal; optional pattern/finish on vision
- `consistency.server.ts` — registry-aware evaluation, dual-read material, NOT_DETECTABLE
- `vision.server.ts` — registry-driven prompt, SSRF download, optional ensemble
- `shopify-fixes.server.ts` — FixPolicy + metafield writes; title rewrite gated
- `analysis-pipeline.server.ts` — metafields + shop settings + persist
- `app._index.tsx` — Catalog Health Inbox
- `app.guardian.$productId.tsx` — policy, audit, confidence bands, feedback, Apply All Safe
- `webhooks.app.uninstalled.tsx` — full shop data wipe
- CI + package scripts

## 2. Architecture

```
Triggers → ScanJob/Guardian → pack select → vision → Zod → normalize
→ consistency (registry) → FixPolicyEngine → persist Analysis/Audit
→ Catalog Health / Guardian UX → confirm → mutate → verify
```

## 3. Attributes

| Attribute | Status | Detection | Storage | Fix Policy | Evaluation |
|-----------|--------|-----------|---------|------------|------------|
| Color | PRODUCTION | Vision + pixel blend | Color option | confirm | Deterministic OK; FAFR pending |
| Product type | PRODUCTION | Vision | productType | confirm | Deterministic OK |
| Material | PRODUCTION | Vision | sellenvo.material (+ title fallback) | confirm | Dual-read tested; title default OFF |
| Pattern | EXPERIMENTAL | Vision | sellenvo.pattern | confirm | Gate incomplete |
| Finish | EXPERIMENTAL | Vision | sellenvo.finish | confirm | Gate incomplete |

## 4. Security

| Threat | Mitigation |
|--------|------------|
| SSRF | HTTPS, DNS private-IP block, redirect re-check, size/timeout |
| Client policy bypass | Server FixPolicyEngine ignores safeToApply |
| Prompt injection | No merchant text in system prompt |
| Secrets | Existing logger redaction retained |
| Uninstall | Deletes analyses/jobs/audit/settings/sessions |

Remaining: DNS rebinding race is mitigated by pre-fetch resolve but not TOCTOU-perfect; multi-worker cache not shared.

## 5. Testing

| Command | Result |
|---------|--------|
| `npm run test:consistency` | PASS |
| `npm run test:registry` | PASS (46) |
| `npm run test:mutations` | PASS (14) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npx prisma validate` + migrate | PASS |

## 6. Performance

- Vision cache + listing recheck preserved
- Apply Fix shows Updating… / Verifying… without full-page freeze
- Bulk scans async via ScanJob (not one HTTP request)
- Bottleneck remains Groq latency on full analysis

## 7. Shopify

- Scopes: `read_products,write_products`
- Mutations: productOptionUpdate, productUpdate, metafieldsSet
- Multi-variant color still limited to option value[0] (documented)

## 8. Remaining risks

- No measured False Auto-Fix Rate on real images
- Pattern/Finish must stay EXPERIMENTAL until gate passes
- In-process job runner / process-local cache unsuitable for multi-instance
- E2E against live shop not in CI
- Metafield definition create may need broader scopes on some API versions

## 9. Next steps (impact order)

1. Collect labeled real-image set → measure FAFR per attribute
2. Variant-aware color mutation
3. Postgres + shared rate-limit before horizontal scale
4. Promote pattern/finish only if FAFR acceptable
5. Shopify App Review dry-run with privacy policy evidence

## 10. Explicit verdict

**PILOT READY**

Not PRODUCTION READY / SHOPIFY APP STORE READY — real-image FAFR and App Review evidence incomplete.
