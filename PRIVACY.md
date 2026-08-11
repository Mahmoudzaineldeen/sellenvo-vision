# Privacy & Data Handling — Sellenvo Vision

This document describes what Sellenvo Vision collects, why, how long it is retained, and what is sent to third-party AI providers.

**Last updated:** 2026-08-11

---

## Summary

Sellenvo Vision is a Shopify embedded app that compares **product listing claims** against **visual evidence** from product images. It stores analysis metadata and mutation audit records in an app database. It does **not** store raw image blobs.

---

## Data collected

| Data | Purpose | Storage |
|------|---------|---------|
| OAuth session (shop, access token, optional user name/email) | Authenticate Admin API | Prisma `Session` |
| Product GID, title, image URL, image hash | Catalog integrity analysis | Prisma `Analysis` |
| Listing facts + vision results (JSON) | Persist scan results for Catalog Health | Prisma `Analysis` |
| Suggested fixes + verdicts | Merchant review inbox | Prisma `Analysis` |
| Mutation audit (attribute, old/new value, success, user id) | Accountability / revert | Prisma `AuditEvent` |
| Shop settings (material write mode, toggles) | Merchant preferences | Prisma `ShopSettings` |
| Scan job queue state | Background catalog scans | Prisma `ScanJob` |
| “Vision was wrong” feedback | Evaluation / quality improvement | Prisma `VisionFeedback` |

**Not stored:**
- Raw product image binaries
- Customer order data
- Payment information

---

## What is sent to AI providers

**Primary:** Groq (`GROQ_API_KEY`)  
**Secondary (optional):** OpenRouter (`OPENROUTER_API_KEY`) — only when configured and primary fails with a retryable error

Sent to the vision provider:
- The **product image** (HTTPS Shopify CDN URL preferred, or a temporary data URI fallback)
- Fixed system/user prompts that do **not** include product titles, descriptions, or other merchant listing text

**Prompt-injection resistance:** Merchant product text is never injected into the vision prompt.

Provider switches are logged (provider id only — never API keys).

---

## Retention

| Record | Retention |
|--------|-----------|
| Analyses | 90 days (automated purge on app boot + daily) |
| Audit events | 365 days (automated purge) |
| Sessions / settings / jobs / feedback | Until uninstall or shop redact |

---

## Uninstall & GDPR

| Event | Behavior |
|-------|----------|
| `app/uninstalled` | Deletes all shop-scoped rows (analyses, jobs, audit, feedback, settings, sessions) |
| `shop/redact` | Same shop-wide wipe (idempotent) |
| `customers/data_request` | Returns any Session PII matching the customer email; notes that analyses are product-scoped |
| `customers/redact` | Deletes Session rows matching customer email / user id |

Shopify-side product data and metafield definitions created by the app are **not** deleted on uninstall (standard Shopify app behavior). Merchants can remove `sellenvo.*` metafields in Admin if desired.

---

## Merchant mutations

- No silent catalog writes
- Server-side fix policy authorizes every mutation
- Merchant confirmation required except for explicitly enabled “safe auto-fix” attributes
- Every mutation is verified against Shopify and audited

---

## Contact

For privacy requests related to this app, contact the app developer via the Shopify Partner listing or the support channel configured for your installation.
