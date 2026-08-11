# Visual Listing Guardian — Sellenvo Vision

Shopify-embedded Computer Vision prototype that compares **listing claims** vs **visual evidence**, then applies a **real Admin API mutation** after merchant confirmation.

## Golden path

```text
Real Shopify product → real image → Groq vision analysis →
consistency check → evidence → merchant confirms →
productOptionUpdate → re-fetch verification
```

## Stack

| Layer | Choice |
|-------|--------|
| App | Shopify React Router template |
| UI | Polaris web components |
| Vision | Groq `qwen/qwen3.6-27b` (free tier) + Zod validation |
| Pixel (optional) | colorthief + sharp |
| Storage | Prisma SQLite (sessions only) |

## Setup (one day)

### 1. Prerequisites

- Node.js ≥ 20.19 (or ≥ 22.12)
- Shopify Partner account + development store
- Free Groq API key: https://console.groq.com

### 2. Install

```bash
cd sellenvo-vision
npm install
npx prisma generate
cp .env.example .env
# Add GROQ_API_KEY=... to .env
```

Optional pixel analysis:

```bash
npm install colorthief sharp
```

If `sharp` fails on Windows within ~15 minutes, skip it — vision-only mode is sufficient.

### 3. Link & run

```bash
shopify app config link   # or shopify app dev (will prompt)
shopify app dev
```

Scopes required: `read_products,write_products` (already in `shopify.app.toml`).

### 4. Create demo Product B (golden path)

In Shopify Admin:

1. **Products → Add product**
2. Title: `Red Leather Wallet`
3. Product type: `Wallet`
4. Variants → add option **Color** = `Red`
5. Upload a clearly **BLACK** wallet image
6. Save

Record GIDs in GraphiQL (see `scripts/demo-products.ts`), then **test** `productOptionUpdate` in GraphiQL before relying on the app UI. Reset Color to `Red` after testing.

### 5. Demo flow

1. Open the app → Products list → **Open Guardian** on Product B
2. Click **Analyze Product**
3. See Color Mismatch (Listed: Red, Detected: Black) + derived confidence
4. **View Evidence** → **Apply Fix** → Confirm
5. App re-fetches product and verifies Color is now Black
6. Confirm in Shopify Admin product page

## Routes

| Path | Purpose |
|------|---------|
| `/app` | Product list |
| `/app/guardian/:productId` | Analyze + fix (numeric ID or full GID) |

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System layers, domain model, ADRs |
| [docs/AI_PIPELINE.md](docs/AI_PIPELINE.md) | Models, prompts, sanitization, timeouts |
| [docs/MUTATIONS.md](docs/MUTATIONS.md) | Shopify write safety |
| [docs/MUTATION_CHECKLIST.md](docs/MUTATION_CHECKLIST.md) | GraphiQL preflight |
| [docs/FAILURE_MODES.md](docs/FAILURE_MODES.md) | Troubleshooting & ops |
| [docs/EVALUATION.md](docs/EVALUATION.md) | Real-image accuracy eval (not unit tests) |

## Tests

```bash
npm run test:consistency   # deterministic engine + contract tests (CI)
npm run typecheck
npm run test:vision        # optional live Groq smoke (needs GROQ_API_KEY)
```

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `GROQ_API_KEY` | Yes (for analysis) | Vision API (primary) |
| `GROQ_API_KEY_FALLBACK` | Optional | Second Groq key when primary rate-limits |
| `SHOPIFY_*` / `SCOPES` | Via CLI | OAuth |
| `DEMO_BLACK_WALLET_IMAGE_URL` | Optional | Demo image attach |
| `TEST_IMAGE_URL` | Optional | Vision smoke override |

## Fallbacks

- Groq down → analysis fails safely with toast; retry later (OpenRouter is documented in `.env.example` but not wired)
- colorthief/sharp fail → automatic skip, vision-only
- Mutation shape issues → test in GraphiQL first; see `docs/MUTATION_CHECKLIST.md`

## Security

- AI keys only on the server (`GROQ_API_KEY`)
- Mutations require explicit merchant confirmation
- Server re-verifies product after write
- Vision output treated as untrusted; consistency engine is deterministic
- Rate limit: 5 mutations per minute per product
