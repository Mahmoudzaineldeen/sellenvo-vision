# Sellenvo Vision — Catalog Integrity for Shopify

Product listings sometimes claim one thing while the product image shows another.

**Sellenvo Vision** is a Shopify Catalog Integrity app that:

1. Scans product images
2. Compares visual evidence to listing claims (color, product type, material, …)
3. Shows merchants what needs attention — with evidence
4. Lets merchants confirm corrections
5. Applies verified Shopify mutations with an audit trail

It is **not** an AI tagging/enrichment toy. It is a conservative integrity loop:

```text
Listing → Visual evidence → Compare → Merchant decision → Safe mutation → Verify → Audit
```

---

## Why it matters

Inconsistent listings create returns, support tickets, and lost trust.

Sellenvo helps merchants answer:

> What is wrong, why do we think that, what will change if I click Fix, and did Shopify actually update?

---

## Merchant flow

```text
Catalog Health
  → listing needs attention
  → evidence (listed vs detected)
  → review proposed change
  → confirm
  → Shopify verified
  → audit recorded
```

Primary screen: **Catalog Health** — “What needs my attention?”

Per-product screen: **Guardian** — evidence, Apply Fix, Manual Edit, Apply All (safe / review).

---

## Demo

Use **Seed demo catalog** in Catalog Health (explicitly labeled `[Demo]` products):

| Case | What it shows |
|------|----------------|
| Correct black wallet | Healthy match |
| Red listing + black image | Color mismatch (golden path) |
| Plastic title + leather-looking image | Material review |
| Bag type + wallet-like image | Product type review |
| No image | Graceful failure |

Or create a single golden-path product: **Create Demo Product B**.

---

## Attribute status

| Attribute | Status | Storage | Fix policy |
|-----------|--------|---------|------------|
| Color | PRODUCTION | Shopify Color option | Safe (only if shop enables auto-fix) |
| Product type | PRODUCTION | `productType` | Confirm |
| Material | PRODUCTION | `sellenvo.material` metafield (default) | Confirm |
| Pattern | EXPERIMENTAL | `sellenvo.pattern` | Confirm |
| Finish | EXPERIMENTAL | `sellenvo.finish` | Confirm |

Pattern/Finish stay experimental until evaluation evidence justifies promotion.

**Internal evaluation only** — model confidence is not claimed accuracy. See [docs/EVALUATION.md](docs/EVALUATION.md).

---

## Setup

### Prerequisites

- Node.js ≥ 20.19 (or ≥ 22.12)
- Shopify Partner account + development store
- Groq API key: https://console.groq.com

### Install & run

```bash
cd sellenvo-vision
npm install
npx prisma generate
cp .env.example .env
# Add GROQ_API_KEY=... to .env

npm run dev
```

This app registers **webhooks**, so the default uses a Cloudflare tunnel (Shopify cannot
deliver webhooks to `localhost`).

**Always open the app via the Preview URL** printed in the terminal:

```text
https://admin.shopify.com/store/<your-store>/apps/<app-id>
```

Do **not** open or bookmark the raw `*.trycloudflare.com` URL — those hostnames are
ephemeral and often fail DNS (“server IP address could not be found”).

If the tunnel DNS fails:

1. Press `q` to quit
2. Run `npm run dev` again (gets a **new** tunnel hostname)
3. Open the new **Preview URL** from Shopify Admin

Scopes: `read_products,write_products`.

Optional: `OPENROUTER_API_KEY` for secondary vision fallback.

### Localhost-only (UI smoke test)

```bash
npm run dev:localhost
```

Works for many UI flows, but **cannot** register webhooks / App Proxy / Flow. Prefer
`npm run dev` for normal Catalog Integrity testing.

---

## Stack

| Layer | Choice |
|-------|--------|
| App | Shopify React Router + Vite |
| UI | Polaris web components |
| Vision | Groq (primary) + optional OpenRouter fallback |
| Validation | Zod |
| Storage | Prisma + SQLite (single-instance pilot) |
| Jobs | DB-backed in-process poller |

SQLite stores sessions **and** analyses, scan jobs, audit events, shop settings, and feedback. PostgreSQL is a documented migration path when multi-instance scale is required — not needed for pilot.

---

## Routes

| Path | Purpose |
|------|---------|
| `/app` | Catalog Health inbox |
| `/app/guardian/:productId` | Per-product Guardian |
| `/app/settings` | Material write mode, auto-scan, safe auto-fix |

---

## Documentation

| Doc | Contents |
|-----|----------|
| [PRIVACY.md](PRIVACY.md) | Data collection, AI providers, retention, GDPR |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [docs/AI_PIPELINE.md](docs/AI_PIPELINE.md) | Vision pipeline |
| [docs/MUTATIONS.md](docs/MUTATIONS.md) | Mutation safety |
| [docs/EVALUATION.md](docs/EVALUATION.md) | Evaluation methodology |
| [docs/FAILURE_MODES.md](docs/FAILURE_MODES.md) | Ops troubleshooting |
| [docs/CATALOG_INTEGRITY.md](docs/CATALOG_INTEGRITY.md) | Product model |

---

## Tests

```bash
npm run test:consistency   # deterministic engine (CI)
npm run test:registry      # attribute registry + policy
npm run test:mutations     # mocked Shopify mutations
npm run typecheck
npm run lint
npm run build
```

Optional live vision: `npm run test:vision` (requires `GROQ_API_KEY`).

Eval scorecard (internal): `npx tsx scripts/eval-scorecard.ts`

---

## Known limitations (honest)

- Color analysis uses the **first** Color option value only (multi-variant UI warns)
- Vision cache and mutation rate limits are process-local (single-instance pilot)
- Pattern/Finish are experimental and gated by settings
- No fabricated return/revenue metrics — only measured internal evaluation
