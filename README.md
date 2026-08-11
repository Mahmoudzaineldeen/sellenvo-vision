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

## Business problem

Fashion, accessories, home, and general merchandise catalogs drift over time:

| Pain | What happens in the store |
|------|---------------------------|
| Visual/metadata mismatch | Color, material, or type on the listing doesn’t match the photo |
| Customer distrust | Buyers feel misled → refunds, chargebacks, negative reviews |
| Ops drag | Support and catalog teams manually spot-check products |
| Silent AI risk | Auto-tagging tools rewrite fields without proof or audit |

Sellenvo is built for **catalog managers and merchant operators** who need a trustworthy “what’s wrong and can I fix it safely?” workflow — not another enrichment dashboard.

### Who it’s for

- Shopify merchants with image-led catalogs (apparel, bags, footwear, jewelry, accessories, home)
- Teams that already feel returns/support pressure from listing quality
- Operators who will **not** accept silent title rewrites or unverified AI mutations

### What merchants get

> Trusted visual integrity + conservative detection + merchant-controlled correction + verified Shopify mutations + auditability.

### Merchant ROI

| Business outcome | How Sellenvo delivers | Measured result |
|------------------|----------------------|-----------------|
| Catch bad listings before customers do | Catalog Health inbox prioritizes mismatches | **95%** detection agreement on evaluated cases |
| Fix listings with confidence | Suggested corrections merchants can approve | **83%** suggested-fix correctness |
| Avoid reckless automation | Confirm-first workflow; safe auto-fix off by default | **17%** False Auto-Fix Rate tracked as a safety brake |
| Spend less time hunting issues | Scan → review → fix loop instead of manual spot-checks | Actionable MATCH/MISMATCH on **85%** of evaluated cases |
| Keep uncertain cases out of “force fix” | UNCERTAIN / NOT_DETECTABLE instead of guessing | **5%** uncertain · **10%** not-detectable |

Primary screen: **Catalog Health** — “What needs my attention?”  
Per-product screen: **Guardian** — evidence, Apply Fix, Manual Edit, Apply All.

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

---

## Accuracy & attribute performance

| Metric | Result |
|--------|--------|
| Detection agreement | **95.0%** |
| Suggested-fix correctness | **83.3%** |
| False Auto-Fix Rate | **16.7%** |
| Uncertain rate | **5.0%** |
| Not-detectable rate | **10.0%** |

| Attribute | Status | Detection agreement | False Auto-Fix Rate |
|-----------|--------|---------------------|---------------------|
| Color | PRODUCTION | **88.9%** | 33.3% |
| Product type | PRODUCTION | **100%** | 0% |
| Material | PRODUCTION | **100%** | 0% |
| Pattern | EXPERIMENTAL | — | confirm-only |
| Finish | EXPERIMENTAL | — | confirm-only |

Confidence in the UI is shown as High / Medium / Low. Re-run the scorecard anytime: `npx tsx scripts/eval-scorecard.ts`. Methodology: [docs/EVALUATION.md](docs/EVALUATION.md).

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

Eval scorecard: `npx tsx scripts/eval-scorecard.ts`
