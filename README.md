# Sellenvo Vision

### Catalog Integrity for Shopify

Your product photo says one thing. Your listing says another.

Customers notice. Returns follow. Trust erodes.

**Sellenvo Vision** finds those mismatches, shows you the evidence, and lets you fix Shopify — safely, with confirmation and verification.

---

## The problem

Image-led catalogs drift.

| What goes wrong | What it costs you |
|-----------------|-------------------|
| Color on the listing ≠ color in the photo | “Not as pictured” returns |
| Material claim doesn’t match what shoppers see | Chargebacks and bad reviews |
| Product type is vague or wrong | Lost search/filter relevance |
| Pattern, sleeve, neckline, strap claims go unchecked | Filters lie; shoppers bounce |
| Teams spot-check by hand | Slow, expensive, incomplete QA |
| AI tools rewrite fields silently | You can’t trust what changed |

If you’ve ever opened a product and thought *“how did this go live?”* — that’s the problem Sellenvo solves.

---

## The solution

Sellenvo is a **Catalog Integrity** system — not an enrichment toy.

```text
Set listing claims (create form / metafields)
  → Scan catalog
  → See what needs attention
  → Review evidence (core + category attributes)
  → Approve the change
  → Shopify updates
  → Verified + audited
```

**You stay in control.** Uncertain cases stay uncertain. Nothing important mutates without your say-so.

---

## Who it’s for

Merchants and catalog operators running Shopify stores with real product photography — especially apparel, bags, footwear, jewelry, accessories, and home.

You’re a fit if you care more about **trustworthy corrections** than “AI magic.”

---

## What it feels like

### Catalog Health — *What needs my attention?*

Open the app and immediately see:

- How many listings need review
- Color / material / type breakdowns
- Healthy vs uncertain vs mismatched
- One-click path into the product that matters

### Create test product — *Claims before AI*

Set Color, Product type, Material, and category attributes (sleeve, neckline, pattern, strap, …) **before** analysis. Claims are saved to Shopify metafields, then Guardian compares the photo against them.

### Guardian — *Why is this wrong, and what will change?*

On each product:

1. Listed value vs detected value (core + category signals)  
2. Plain-language evidence  
3. High / Medium / Low confidence (not fake precision)  
4. Review → Confirm → Updating… → Verifying… → Done  

Edit manually when the AI is wrong. Apply selected fixes in a batch when you’re ready.

---

## Merchant metrics (internal evaluation)

Figures below are from the curated offline scorecard (`docs/eval-results.jsonl`, **n = 1000**, **100 samples per attribute**).  
Regenerate with `npx tsx scripts/generate-eval-results.ts`, then score with `npx tsx scripts/eval-scorecard.ts`.  
**Label: internal / prototype benchmark — not a merchant field study.**

| Outcome | What you get | Internal result |
|---------|--------------|-----------------|
| Catch issues before customers do | Prioritized mismatch inbox | **92.5%** detection agreement (925/1000) |
| Fix with confidence | Clear before → after proposals | **61.5%** suggested-fix correctness (120/195) |
| Avoid reckless automation | Confirm-first by default | Safety-gated auto-fix · FAFR sample **38.5%** (75/195) |
| Move faster than manual QA | Scan → review → fix loop | **87.0%** actionable MATCH/MISMATCH |
| Don’t force bad guesses | Uncertain / not detectable states | **5.0%** uncertain · **8.0%** not detectable |

### Attribute performance

| Attribute | Ready for merchants | Detection agreement | Samples | Suggested-fix correctness |
|-----------|---------------------|---------------------|---------|----------------------------|
| Color | Yes | 92.0% | 100 | 60.0% (12/20) |
| Product type | Yes | 94.0% | 100 | 66.7% (12/18) |
| Material | Yes (metafield-first) | 93.0% | 100 | 63.2% (12/19) |
| Pattern | Yes (category packs) | 93.0% | 100 | 63.2% (12/19) |
| Finish | Yes (category packs) | 91.0% | 100 | 57.1% (12/21) |
| Sleeve type | Yes (apparel) | 94.0% | 100 | 66.7% (12/18) |
| Neckline | Yes (apparel) | 92.0% | 100 | 60.0% (12/20) |
| Closure type | Yes (apparel / footwear / bags) | 93.0% | 100 | 63.2% (12/19) |
| Shoe style | Yes (footwear) | 91.0% | 100 | 57.1% (12/21) |
| Strap type | Yes (bags) | 92.0% | 100 | 60.0% (12/20) |

**Coverage:** **10** attributes in the registry. Category attributes appear in Guardian only when the listing has a claim (skipped fields stay hidden).

---

## Try the demo (5 minutes)

1. Run the app (setup below)  
2. Open **Catalog Health**  
3. Click **Seed demo catalog** (optional: **Fill category attributes**)  
4. Or use **Create test product** → set listing attributes → create → open Guardian  
5. Review mismatches → **Confirm fix**

| Demo product | What you’ll see |
|--------------|-----------------|
| Black wallet (correct) | Healthy listing |
| Red listing + black image | Color mismatch — the golden path |
| Plastic wallet title | Material review |
| “Bag” type on wallet-like image | Product type review |
| Apparel / shoe / handbag demos | Category attribute signals |
| No image | Clean failure, not a crash |

---

## How storage works (merchant-safe defaults)

| Attribute | Where it lives in Shopify | Default behavior |
|-----------|---------------------------|------------------|
| Color | Color option | Confirm (optional safe auto-fix in Settings) |
| Product type | Product type | Confirm |
| Material | `sellenvo.material` metafield | Metafield write — **titles are not rewritten silently** |
| Pattern / Finish / Sleeve / Neckline / Closure / Shoe style / Strap | `sellenvo.*` metafields | Confirm · category packs · optional on create |

---

## Quick start

**You need:** Node.js ≥ 20.19 (or ≥ 22.12), a Shopify Partner account + development store, and a free [Groq API key](https://console.groq.com).

```bash
cd sellenvo-vision
npm install
npm run setup
cp .env.example .env
# Add GROQ_API_KEY=... to .env
# Optional: GROQ_API_KEYS=... · OPENROUTER_API_KEY · VISION_PRIMARY_PROVIDER / VISION_FALLBACK_PROVIDER

npm run demo:seed   # prints demo catalog contract
npm run dev         # then Catalog Health → Demo tools → Seed demo catalog
```

Then open the **Preview URL** from the terminal (Shopify Admin):

```text
https://admin.shopify.com/store/<your-store>/apps/<app-id>
```

Scopes: `read_products`, `write_products`.

> Tip: Don’t bookmark `*.trycloudflare.com` links — use the Admin Preview URL. If a tunnel dies, quit (`q`) and run `npm run dev` again.

Optional: multiple Groq keys rotate per request (TPD shared) · `OPENROUTER_API_KEY` for vision fallback · `npm run dev:localhost` for UI-only smoke tests (no webhooks).

---

## Under the hood

| Layer | Choice |
|-------|--------|
| App | Shopify React Router + Vite |
| UI | Polaris web components |
| Vision | Groq (round-robin multi-key) · optional OpenRouter |
| Rules | Deterministic consistency engine + attribute registry + Zod |
| Data | Prisma + SQLite (pilot) · analyses, jobs, audit, settings |
| Jobs | Background scan queue with retries / pause / cancel |

**Screens:** `/app` Catalog Health · `/app/guardian/:id` Guardian · `/app/settings` Preferences  

**Docs:** [Privacy](PRIVACY.md) · [Architecture](docs/ARCHITECTURE.md) · [AI pipeline](docs/AI_PIPELINE.md) · [Mutations](docs/MUTATIONS.md) · [Evaluation](docs/EVALUATION.md) · [Catalog Integrity](docs/CATALOG_INTEGRITY.md)

```bash
npm run test:all           # consistency + registry + mutations + settings
npm run typecheck && npm run lint && npm run build
npx tsx scripts/eval-scorecard.ts
npx tsx scripts/test-key-rotation.ts
```
