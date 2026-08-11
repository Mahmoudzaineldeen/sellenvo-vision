# Shopify Mutation Safety

## Writable fields

| Signal | Shopify API | Target |
|--------|-------------|--------|
| Color | `productOptionUpdate` | First Color/Colour option value name |
| Product type | `productUpdate` | `product.productType` |
| Material | `metafieldsSet` (+ optional title) | `sellenvo.material` metafield by default (`materialWriteMode`) |

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

Successful mutations are audited (append-only). Guardian **Recent changes** offers
**Restore previous**, which:

1. Loads the latest successful non-revert audit for that attribute
2. Re-fetches Shopify state
3. Blocks automatically if current value ≠ audited `newValue` (stale)
4. Allows confirmed force-restore when the merchant acknowledges the conflict
5. Mutates back to `oldValue`, verifies, and writes a new audit (`reason: revert`)

There is no silent overwrite of merchant changes after the fix.
