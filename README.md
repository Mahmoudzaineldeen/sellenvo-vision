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

### What we sell (positioning)

> Trusted visual integrity + conservative detection + merchant-controlled correction + verified Shopify mutations + auditability.

Differentiation is **trust and safety**, not “we use computer vision.”

### Business value levers (what a pilot should measure)

| Lever | How Sellenvo helps | How to measure in a pilot |
|-------|--------------------|---------------------------|
| Fewer bad listings live | Inbox surfaces mismatches before customers do | Mismatches found / corrected per week |
| Faster catalog QA | Batch scan + prioritized “needs attention” | Minutes per reviewed product vs manual |
| Safer corrections | Confirm → mutate → verify → audit | Mutation success rate; zero silent writes |
| Lower false automation risk | Safe auto-fix off by default; FAFR tracked | False Auto-Fix Rate on approved attributes |

**We do not claim** return reduction %, revenue lift, or ROI until a live merchant pilot produces those numbers.

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

## Accuracy & evaluation

### Label (read this first)

```text
INTERNAL EVALUATION / PROTOTYPE BENCHMARK
```

Figures below come from `docs/eval-results.jsonl` (20 curated cases covering match, mismatch, alias, uncertain, and not-detectable paths).  
They are **not** a merchant field study and **not** live multi-store accuracy.

Model confidence (High / Medium / Low) is **never** presented as empirical accuracy.

### Prototype scorecard (run: `npx tsx scripts/eval-scorecard.ts`)

| Metric | Result | Notes |
|--------|--------|-------|
| Samples | 20 | Curated internal cases |
| Detection agreement | **95.0%** (19/20) | Human-labeled expected detection vs recorded outcome |
| Suggested-fix correctness | **83.3%** (5/6) | Among cases that proposed a fix |
| False Auto-Fix Rate (FAFR) | **16.7%** (1/6) | Critical safety metric — why safe auto-fix stays off by default |
| Uncertain rate | **5.0%** | Engine prefers UNCERTAIN over guessing |
| Not-detectable rate | **10.0%** | Unrecognized / unknown materials are not forced into MISMATCH |

#### By attribute (same internal set)

| Attribute | Status | Detection agreement | FAFR | Samples |
|-----------|--------|---------------------|------|---------|
| Color | PRODUCTION | 88.9% | 33.3% | 9 |
| Product type | PRODUCTION | 100.0% | 0.0% | 5 |
| Material | PRODUCTION | 100.0% | 0.0% | 6 |
| Pattern | EXPERIMENTAL | — | — | gated / not in this set |
| Finish | EXPERIMENTAL | — | — | gated / not in this set |

### Deterministic engine (CI — separate from vision accuracy)

The consistency / normalization / policy engine is covered by automated tests (`npm run test:consistency`, `test:registry`, `test:mutations`). These prove **rules correctness**, not photo recognition accuracy. See [docs/EVALUATION.md](docs/EVALUATION.md) for the real-image eval protocol and FAFR promotion gate.

### Safety posture that follows from the numbers

- Default: **merchant confirmation** for almost all fixes
- `safeAutoFixEnabled` defaults to **off**
- Color is the only `safe`-eligible attribute, and only when the shop explicitly enables it
- FAFR must improve on a real-image set before broadening auto-fix

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

Eval scorecard (internal): `npx tsx scripts/eval-scorecard.ts`

---

## Known limitations (honest)

- Color analysis uses the **first** Color option value only (multi-variant UI warns)
- Vision cache and mutation rate limits are process-local (single-instance pilot)
- Pattern/Finish are experimental and gated by settings
- Accuracy tables above are **internal prototype benchmarks**, not merchant ROI proof
- No claimed return/revenue lift until a live pilot measures it
