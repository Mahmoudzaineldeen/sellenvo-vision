# Catalog Integrity — architecture notes & App Store readiness evidence

## Data flow

```
Triggers (Guardian / webhook / bulk ScanJob)
  → Category pack selection
  → Registry-driven vision prompt
  → Zod validation
  → Normalization (per attribute)
  → Consistency evaluation (NOT_DETECTABLE / NOT_APPLICABLE never → MISMATCH)
  → FixPolicyEngine (server-side; ignores client safeToApply)
  → Persist Analysis + AuditEvent
  → Catalog Health Inbox
  → Merchant confirm → Shopify mutation → verify
```

## Attribute status

| Attribute | Status | Storage | Fix policy | Evaluation |
|-----------|--------|---------|------------|------------|
| Color | PRODUCTION | Color option | safe (confirm unless shop enables safe auto-fix) | Deterministic tests; real-image FAFR pending |
| Product type | PRODUCTION | productType | confirm | Deterministic tests |
| Material | PRODUCTION | sellenvo.material (+ title fallback) | confirm | Dual-read tests; title rewrite default OFF |
| Pattern | EXPERIMENTAL | sellenvo.pattern | confirm | Gate incomplete — not production |
| Finish | EXPERIMENTAL | sellenvo.finish | confirm | Gate incomplete — not production |

## Known limitations

- Multi-variant color uses option value[0] only (documented, not solved).
- Process-local vision cache + mutation rate limit (not multi-worker safe yet).
- Job runner is in-process (concurrency 1–2); Postgres / distributed workers deferred.
- Real-image False Auto-Fix Rate not yet measured at scale — do not claim App Store readiness on vision accuracy alone.

## Scaling path (when needed)

1. Postgres datasource in Prisma
2. Shared cache / rate-limit store
3. Dedicated worker process consuming ScanJob
4. No Redis required until multi-instance proven necessary

## App Store checklist (evidence)

- [x] Auth via Shopify session
- [x] Scopes: read_products, write_products
- [x] Uninstall deletes shop data
- [x] Retention: analyses 90d, audit 1y
- [x] No silent title rewrite (default metafield)
- [x] Merchant confirmation for mutations
- [x] Mutation verification
- [x] SSRF protections on image fetch
- [x] Webhook HMAC via authenticate.webhook
- [ ] Real-image evaluation scorecard with FAFR
- [ ] Full E2E against live shop in CI
