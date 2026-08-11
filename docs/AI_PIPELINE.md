# AI / Vision Pipeline

## Models

| Priority | Model |
|----------|-------|
| Primary | `qwen/qwen3.6-27b` (`reasoning_effort: none`, JSON mode preferred) |
| Fallback | Same model with alternate strategies (HTTPS URL → data URI; json → text). Llama 4 Scout was deprecated Jul 2026. |
| Timeout | 60s per Groq call |

Each model is tried with JSON mode off, then on (up to 4 attempts).

## Inputs

- Product **image only** (downloaded server-side → data URI)
- Hardcoded system + user prompts
- **Product titles / descriptions are never injected into the prompt** (prompt-injection resistance)

## Outputs (Zod `VisionResponseSchema`)

```json
{
  "primaryColor": "string",
  "colorConfidence": 0.0,
  "productType": "string",
  "productTypeConfidence": 0.0,
  "material": "string",
  "materialConfidence": 0.0,
  "imageQuality": "good|fair|poor",
  "reasoning": "string"
}
```

## Post-processing (untrusted → sanitized)

1. Parse / extract JSON (strip thinking tags, fences)
2. Zod validate
3. Clamp confidence to **≤ 0.95**
4. Normalize material aliases; unrecognized materials (`suede`, `canvas`, …) → `unknown`
5. Optional pixel color (same image buffer; never blocks vision path)

## Timeouts & limits

| Resource | Limit |
|----------|-------|
| Image download | 15s, 4MB (vision) / 10MB (pixel helper) |
| Groq call | 30s per attempt |

## Failure behavior

- All model strategies fail → analysis returns actionable error (check `GROQ_API_KEY`)
- Pixel extraction fails → vision-only continues
- `imageQuality: poor` → overall `UNCERTAIN`, no auto-fixes offered

## What unit tests prove vs do not prove

| Proves | Does not prove |
|--------|----------------|
| Schema validation | Color/type/material accuracy on real photos |
| Consistency rules | Confidence calibration |
| Fix eligibility gates | Hallucination rate |

See [EVALUATION.md](./EVALUATION.md) for real-image evaluation.
