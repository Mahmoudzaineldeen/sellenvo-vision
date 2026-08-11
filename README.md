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
| Teams spot-check by hand | Slow, expensive, incomplete QA |
| AI tools rewrite fields silently | You can’t trust what changed |

If you’ve ever opened a product and thought *“how did this go live?”* — that’s the problem Sellenvo solves.

---

## The solution

Sellenvo is a **Catalog Integrity** system — not an enrichment toy.

```text
Scan catalog
  → See what needs attention
  → Review evidence
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

### Guardian — *Why is this wrong, and what will change?*

On each product:

1. Listed value vs detected value  
2. Plain-language evidence  
3. High / Medium / Low confidence (not fake “91.7% accuracy”)  
4. Review → Confirm → Updating… → Verifying… → Done  

Edit manually when the AI is wrong. Apply selected fixes in a batch when you’re ready.

---

## Merchant ROI

| Outcome | What you get | Result |
|---------|--------------|--------|
| Catch issues before customers do | Prioritized mismatch inbox | **95%** detection agreement |
| Fix with confidence | Clear before → after proposals | **83%** suggested-fix correctness |
| Avoid reckless automation | Confirm-first by default | Safety-gated auto-fix |
| Move faster than manual QA | Scan → review → fix loop | **85%** actionable MATCH/MISMATCH cases |
| Don’t force bad guesses | Uncertain / not detectable states | **5%** uncertain · **10%** not detectable |

### Attribute performance

| Attribute | Ready for merchants | Detection agreement |
|-----------|---------------------|---------------------|
| Color | Yes | **88.9%** |
| Product type | Yes | **100%** |
| Material | Yes (metafield-first) | **100%** |
| Pattern | Experimental | Confirm-only |
| Finish | Experimental | Confirm-only |

---

## Try the demo (5 minutes)

1. Run the app (setup below)  
2. Open **Catalog Health**  
3. Click **Seed demo catalog**  
4. Review the mismatches → open **Guardian** → **Confirm fix**

| Demo product | What you’ll see |
|--------------|-----------------|
| Black wallet (correct) | Healthy listing |
| Red listing + black image | Color mismatch — the golden path |
| Plastic wallet title | Material review |
| “Bag” type on wallet-like image | Product type review |
| No image | Clean failure, not a crash |

---

## How storage works (merchant-safe defaults)

| Attribute | Where it lives in Shopify | Default behavior |
|-----------|---------------------------|------------------|
| Color | Color option | Confirm (optional safe auto-fix in Settings) |
| Product type | Product type | Confirm |
| Material | `sellenvo.material` metafield | Metafield write — **titles are not rewritten silently** |
| Pattern / Finish | Metafields | Experimental, confirm-only |

---

## Quick start

**You need:** Node.js ≥ 20.19 (or ≥ 22.12), a Shopify Partner account + development store, and a free [Groq API key](https://console.groq.com).

```bash
cd sellenvo-vision
npm install
npx prisma generate
cp .env.example .env
# Add GROQ_API_KEY=... to .env

npm run dev
```

Then open the **Preview URL** from the terminal (Shopify Admin):

```text
https://admin.shopify.com/store/<your-store>/apps/<app-id>
```

Scopes: `read_products`, `write_products`.

> Tip: Don’t bookmark `*.trycloudflare.com` links — use the Admin Preview URL. If a tunnel dies, quit (`q`) and run `npm run dev` again.

Optional: `OPENROUTER_API_KEY` for vision fallback · `npm run dev:localhost` for UI-only smoke tests (no webhooks).

---

## Under the hood

| Layer | Choice |
|-------|--------|
| App | Shopify React Router + Vite |
| UI | Polaris web components |
| Vision | Groq (primary) · optional OpenRouter |
| Rules | Deterministic consistency engine + Zod |
| Data | Prisma + SQLite (pilot) · analyses, jobs, audit, settings |
| Jobs | Background scan queue with retries |

**Screens:** `/app` Catalog Health · `/app/guardian/:id` Guardian · `/app/settings` Preferences  

**Docs:** [Privacy](PRIVACY.md) · [Architecture](docs/ARCHITECTURE.md) · [AI pipeline](docs/AI_PIPELINE.md) · [Mutations](docs/MUTATIONS.md) · [Evaluation](docs/EVALUATION.md) · [Catalog Integrity](docs/CATALOG_INTEGRITY.md)

```bash
npm run test:consistency   # rules engine
npm run test:registry      # attributes & policy
npm run test:mutations     # Shopify mutation safety
npm run typecheck && npm run lint && npm run build
npx tsx scripts/eval-scorecard.ts
```

---

Sellenvo doesn’t replace your judgment.  
It finds what’s wrong, proves why, and changes only what you approve.
