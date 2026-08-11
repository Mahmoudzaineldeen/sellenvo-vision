# Shopify Mutation Safety

## Writable fields

| Signal | Shopify API | Target |
|--------|-------------|--------|
| Color | `productOptionUpdate` | First Color/Colour option value name |
| Product type | `productUpdate` | `product.productType` |
| Material | `productUpdate` | Product **title** (keyword rewrite) |

## Safety rules

1. Merchant must confirm (modal) before any write
2. Fixes only offered when: MISMATCH + confidence ≥ 0.7 + image quality ≠ poor (+ option IDs for color)
3. `fixesJson` / single-fix inputs validated before mutation
4. Type + material share **one** `productUpdate` (no lost-update race)
5. Color runs in parallel with product update (independent APIs)
6. Post-mutation **re-fetch verification**
7. Rate limit: **5 mutations / 60 seconds / product**
8. Successful partial Apply All is reported as partial — never total success if any field failed

## Manual GraphiQL checklist

See [MUTATION_CHECKLIST.md](./MUTATION_CHECKLIST.md).

## Rollback

No automatic rollback. Merchant can re-edit in Shopify Admin or Apply Fix again with a corrected value.
