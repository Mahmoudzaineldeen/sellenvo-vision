# Vision Evaluation Dataset (spec)

Deterministic unit tests **do not** measure vision accuracy. Use this dataset to evaluate real images offline.

## Metrics to record

| Metric | Definition |
|--------|------------|
| Color accuracy | Detected primary color matches human label (after color normalization) |
| Product type accuracy | Detected type matches label (after product-type normalization / category rules) |
| Material accuracy | Detected material matches label (after material aliases); `unknown` excluded from accuracy denom |
| Confidence calibration | Among predictions with confidence ≥ 0.7, what fraction are correct? |
| False mismatch rate | Listing correct, engine says MISMATCH |
| False match rate | Listing wrong, engine says MATCH |
| Uncertain rate | Share of `UNCERTAIN` overall verdicts |

## Suggested set (15–20 images)

Include at least one of each stress case:

| ID | Category | Lighting | Background | Notes |
|----|----------|----------|------------|-------|
| E01 | Wallet leather black | Neutral | White | Golden-path demo |
| E02 | Wallet claimed red / image black | Neutral | White | Intentional mismatch |
| E03 | Cotton t-shirt blue | Warm indoor | Colored wall | White-balance stress |
| E04 | Metal bottle silver | Cool / daylight | Reflective | Silver vs gray |
| E05 | Gold chain necklace | Studio | White | Gold vs yellow |
| E06 | Handbag brown leather | Outdoor shade | Busy | Secondary objects |
| E07 | Sneaker white | Flash | Softbox | Overexposure |
| E08 | Plastic phone case clear | Neutral | White | Transparent |
| E09 | Product on model | Mixed | Lifestyle | Worn apparel |
| E10 | Packaged product | Shelf | Retail | Box vs product color |
| E11 | Multi-item flat lay | Neutral | Wood | Ambiguous primary |
| E12 | Cropped product | Close-up | Blur | Partial view |
| E13 | Low-res / blurry | Any | Any | Expect `poor` / UNCERTAIN |
| E14 | Denim jacket | Daylight | Outdoor | Material denim vs cotton |
| E15 | Wooden frame | Warm | Indoor | Wood vs brown |

## Procedure

1. Store images locally or as public URLs (document source licenses)
2. Human-label: `color`, `productType`, `material`, `imageQuality`, notes
3. Run `npm run test:vision` with `TEST_IMAGE_URL=<url>` (or a small batch script)
4. Record predicted vs labeled values + confidences in a spreadsheet
5. Do **not** claim production accuracy without this evidence

## Ground-truth template

```csv
id,url,label_color,label_type,label_material,label_quality,notes
E01,https://...,black,wallet,leather,good,demo
```

## Out of scope for v1 automation

- Automated CI vision accuracy gates (costs API calls; flaky)
- Continuous eval pipeline

Manual periodic runs (e.g. before release) are sufficient until volume justifies automation.
