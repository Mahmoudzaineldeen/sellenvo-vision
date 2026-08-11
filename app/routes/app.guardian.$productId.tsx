import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  analysisFromPersistedRow,
  getImageUrl,
  hydrateVisualCacheFromDb,
  isPlaceholderImage,
  runFullAnalysis,
  runListingRecheck,
} from "../lib/analysis-pipeline.server";
import { getLatestAnalysisForProduct } from "../lib/analysis-persist.server";
import {
  clearCachedVisual,
  setCachedVisual,
} from "../lib/vision-cache.server";
import {
  applyShopifyFixes,
  fetchProductNode,
  type FixOutcome,
  type ProductNode,
} from "../lib/shopify-fixes.server";
import { attachDemoWalletImage } from "../lib/attach-demo-image.server";
import { checkMutationRateLimit } from "../lib/mutation-rate-limit.server";
import { logEvent } from "../lib/logger.server";
import type {
  AnalysisResult,
  FixableSignal,
  ListingFacts,
  SuggestedFix,
} from "../lib/types";
import { SuggestedFixesArraySchema } from "../lib/types";
import { extractMaterialFromTitle } from "../lib/consistency.server";
import { FixModal, useFixModal } from "../components/FixModal";
import {
  EXPERIMENTAL_METAFIELD_KEYS,
  getAttribute,
  type AttributeKey,
} from "../lib/attributes";

/** Presentation-only swatches for color signal rows (not business logic). */
const COLOR_SWATCHES: Record<string, string> = {
  black: "#1a1a1a",
  white: "#f5f5f5",
  red: "#c82828",
  blue: "#2850c8",
  green: "#28a03c",
  yellow: "#e6d228",
  orange: "#e6821e",
  purple: "#7832b4",
  pink: "#e678a0",
  brown: "#784628",
  grey: "#8c8c8c",
  gray: "#8c8c8c",
  navy: "#142864",
  beige: "#d2beb0",
  gold: "#c8aa32",
  silver: "#b4b4be",
  maroon: "#6e1428",
  teal: "#1e8c8c",
};

function signalLabel(signal: string): string {
  if (signal === "productType") return "Product Type";
  if (signal === "color") return "Color";
  return getAttribute(signal as AttributeKey)?.label ?? signal;
}

function fixFieldLabel(field: FixableSignal): string {
  if (field === "productType") return "Product type";
  if (field === "color") return "Color";
  return getAttribute(field)?.label ?? field;
}

const ALLOWED_FIX_FIELDS: FixableSignal[] = [
  "color",
  "productType",
  "material",
  ...EXPERIMENTAL_METAFIELD_KEYS,
];

function claimedValueForField(
  field: FixableSignal,
  listing: ListingFacts,
): string | null {
  if (field === "color") return listing.claimedColor;
  if (field === "productType") return listing.productType;
  if (field === "material") return listing.claimedMaterial;
  if (field === "pattern") return listing.claimedPattern ?? null;
  if (field === "finish") return listing.claimedFinish ?? null;
  if (field === "sleeveType") return listing.claimedSleeveType ?? null;
  if (field === "neckline") return listing.claimedNeckline ?? null;
  if (field === "closureType") return listing.claimedClosureType ?? null;
  if (field === "shoeStyle") return listing.claimedShoeStyle ?? null;
  if (field === "strapType") return listing.claimedStrapType ?? null;
  return null;
}

function verdictTone(
  verdict: string,
): "success" | "warning" | "info" {
  if (verdict === "MATCH") return "success";
  if (verdict === "MISMATCH") return "warning";
  return "info";
}

function normalizeProduct(product: ProductNode) {
  const imageUrl = getImageUrl(product);
  const colorOption = product.options.find(
    (o) =>
      o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
  );
  const colorValues = colorOption?.optionValues ?? [];
  return {
    id: product.id,
    title: product.title,
    productType: product.productType,
    options: product.options,
    imageUrl,
    hasUsableImage: Boolean(imageUrl) && !isPlaceholderImage(imageUrl),
    claimedColor: colorValues[0]?.name ?? null,
    /** Honest limitation: only the first Color option value is compared today. */
    colorVariantCount: colorValues.length,
    colorOptionName: colorOption?.name ?? null,
    claimedMaterial: extractMaterialFromTitle(product.title),
  };
}

type FixPhase =
  | "idle"
  | "updating"
  | "rechecking"
  | "done"
  | "error";

type ModalKind = "confirm" | "edit" | "applyAll" | null;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const loaderStarted = Date.now();
  const { admin, session } = await authenticate.admin(request);
  const productId = params.productId;
  if (!productId) {
    throw new Response("Missing productId", { status: 400 });
  }

  const gid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    const shopifyStarted = Date.now();
    const product = await fetchProductNode(admin, gid);
    const shopifyMs = Date.now() - shopifyStarted;
    if (!product) {
      return {
        product: null,
        analysis: null as null,
        autoAnalyze: false,
        materialWriteMode: "metafield" as const,
        loadError:
          "Product not found in Shopify. It may have been deleted — return to Catalog Health.",
        timings: {
          shopifyMs,
          dbMs: 0,
          totalMs: Date.now() - loaderStarted,
        },
      };
    }

    const normalized = normalizeProduct(product);
    let analysis = null as ReturnType<typeof analysisFromPersistedRow>;
    let autoAnalyze = Boolean(normalized.hasUsableImage);
    let dbMs = 0;

    // Instant paint: reuse last analysis for this image (no Groq on open)
    if (normalized.imageUrl && session.shop) {
      try {
        const dbStarted = Date.now();
        const latest = await getLatestAnalysisForProduct(
          session.shop,
          product.id,
        );
        dbMs = Date.now() - dbStarted;
        if (latest?.imageUrl === normalized.imageUrl) {
          const restored = analysisFromPersistedRow(latest);
          if (restored) {
            analysis = restored;
            autoAnalyze = false;
            try {
              const visual = JSON.parse(latest.visualJson);
              if (visual?.visionColor) {
                setCachedVisual(product.id, normalized.imageUrl, visual);
              }
            } catch {
              await hydrateVisualCacheFromDb(
                session.shop,
                product.id,
                normalized.imageUrl,
              );
            }
          }
        }
      } catch {
        /* DB optional for loader — fall through to autoAnalyze */
      }
    }

    let materialWriteMode: "metafield" | "title" | "both" = "metafield";
    try {
      const { getShopSettings } = await import("../lib/shop-settings.server");
      const settings = await getShopSettings(session.shop);
      materialWriteMode = settings.materialWriteMode;
    } catch {
      /* defaults */
    }

    const timings = {
      shopifyMs,
      dbMs,
      totalMs: Date.now() - loaderStarted,
    };
    const { logEvent } = await import("../lib/logger.server");
    logEvent({
      level: "info",
      event: "route.guardian.loader",
      productId: gid,
      durationMs: timings.totalMs,
      details: {
        shopifyMs: timings.shopifyMs,
        dbMs: timings.dbMs,
        cacheHit: Boolean(analysis),
      },
    });

    return {
      product: normalized,
      analysis,
      autoAnalyze,
      materialWriteMode,
      loadError: null,
      timings,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not load product from Shopify.";
    console.error("[guardian] loader failed:", message);
    return {
      product: null,
      analysis: null,
      autoAnalyze: false,
      materialWriteMode: "metafield" as const,
      loadError: message,
      timings: {
        shopifyMs: 0,
        dbMs: 0,
        totalMs: Date.now() - loaderStarted,
      },
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const pipelineCtx = { shop };
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const requestId = String(formData.get("requestId") || "");

  const productIdParam = params.productId;
  if (!productIdParam) {
    return { error: "Missing productId", requestId };
  }
  const gid = productIdParam.startsWith("gid://")
    ? productIdParam
    : `gid://shopify/Product/${productIdParam}`;

  if (intent === "analyze") {
    // Default: memory/DB vision cache → listing compare only.
    // forceFull=1 (manual Re-analyze) always hits Groq.
    const forceFull = String(formData.get("forceFull") || "") === "1";
    const result = forceFull
      ? await runFullAnalysis(admin, gid, pipelineCtx)
      : await runListingRecheck(admin, gid, null, pipelineCtx);
    if (!result.ok) {
      return { error: result.error, requestId };
    }
    return {
      analysis: result.analysis,
      product: normalizeProduct(result.product),
      timings: result.timings,
      requestId,
    };
  }

  if (intent === "recheck") {
    const result = await runListingRecheck(admin, gid, null, pipelineCtx);
    if (!result.ok) {
      return { error: result.error, requestId };
    }
    return {
      analysis: result.analysis,
      product: normalizeProduct(result.product),
      timings: result.timings,
      requestId,
    };
  }

  if (intent === "visionFeedback") {
    const { recordVisionFeedback } = await import("../lib/analysis-persist.server");
    await recordVisionFeedback({
      shop,
      productId: gid,
      attribute: String(formData.get("attribute") || "") || null,
      note: String(formData.get("note") || "Vision was wrong") || null,
    });
    return { feedbackSaved: true, requestId };
  }

  if (intent === "attachDemoImage") {
    try {
      const result = await attachDemoWalletImage(admin, gid);
      if ("error" in result) {
        return { error: result.error, requestId };
      }

      clearCachedVisual(gid);
      clearCachedVisual(result.product.id);

      return {
        product: normalizeProduct(result.product),
        imageAttached: true,
        requestId,
      };
    } catch (err) {
      console.error("[guardian] attachDemoImage failed:", err);
      return {
        error:
          err instanceof Error
            ? err.message
            : "Failed to attach demo image. Upload a black wallet photo in Admin → Products instead.",
        requestId,
      };
    }
  }

  if (intent === "applyFix" || intent === "applyAllFixes") {
    const started = Date.now();
    try {
      const { getShopSettings, toFixSettings } = await import(
        "../lib/shop-settings.server"
      );
      const { recordAuditEvent } = await import(
        "../lib/analysis-persist.server"
      );
      const { evaluateFixPolicy, isSafeAutoFix } = await import(
        "../lib/attributes"
      );
      const shopSettings = await getShopSettings(shop);
      const fixSettings = toFixSettings(shopSettings);

      let fixes: Array<{
        field: FixableSignal;
        newValue: string;
        currentValue?: string;
        optionId?: string;
        optionValueId?: string;
      }> = [];

      if (intent === "applyAllFixes") {
        const mode = String(formData.get("applyMode") || "confirm");
        const raw = String(formData.get("fixesJson") || "[]");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { error: "Invalid fixes payload", requestId };
        }
        const validated = SuggestedFixesArraySchema.safeParse(parsed);
        if (!validated.success) {
          return { error: "Invalid fixes payload shape", requestId };
        }
        // Apply All Safe Fixes: only policy-safe when mode=safe; otherwise confirmed batch
        fixes = validated.data
          .filter((f) => {
            if (mode === "safe") {
              return isSafeAutoFix(f.field, fixSettings);
            }
            const decision = evaluateFixPolicy(f.field, fixSettings);
            return decision.allowed;
          })
          .map((f) => ({
            field: f.field,
            newValue: f.suggestedValue,
            currentValue: f.currentValue,
            optionId: f.optionId,
            optionValueId: f.optionValueId,
          }));
      } else {
        const field = String(formData.get("field") || "color") as FixableSignal;
        const newValue = String(formData.get("newValue") || "").trim();
        if (!newValue) {
          return { error: "Missing fix parameters", requestId };
        }
        const allowedFields: FixableSignal[] = ALLOWED_FIX_FIELDS;
        if (!allowedFields.includes(field)) {
          return { error: `Unsupported fix field: ${field}`, requestId };
        }
        const decision = evaluateFixPolicy(field, fixSettings);
        if (!decision.allowed) {
          return { error: decision.reason, requestId };
        }
        fixes = [
          {
            field,
            newValue,
            currentValue: String(formData.get("currentValue") || ""),
            optionId: String(formData.get("optionId") || "") || undefined,
            optionValueId:
              String(formData.get("optionValueId") || "") || undefined,
          },
        ];
      }

      if (fixes.length === 0) {
        return {
          error:
            intent === "applyAllFixes"
              ? "No safe fixes available to apply"
              : "No fixes to apply",
          requestId,
        };
      }

      const rateLimitError = checkMutationRateLimit(gid);
      if (rateLimitError) {
        logEvent({
          level: "warn",
          event: "mutation.rate_limited",
          productId: gid,
          details: { intent, fields: fixes.map((f) => f.field) },
        });
        return { error: rateLimitError, requestId };
      }

      const mutateStarted = Date.now();
      const { outcomes, product, metafields, timings: mutTimings } =
        await applyShopifyFixes(admin, gid, fixes, {
          settings: fixSettings,
          merchantConfirmed: true,
        });
      const mutateMs = Date.now() - mutateStarted;

      // Approver identity: prefer online user id, then session id
      const auditUserId = (() => {
        const onlineUser =
          session.onlineAccessInfo &&
          "associated_user" in session.onlineAccessInfo
            ? session.onlineAccessInfo.associated_user
            : null;
        if (onlineUser && typeof onlineUser === "object" && "id" in onlineUser) {
          return String(onlineUser.id);
        }
        // Prisma-backed offline sessions may carry userId via index signature
        const maybeUserId = (session as { userId?: unknown }).userId;
        if (maybeUserId != null) return String(maybeUserId);
        return session.id ?? null;
      })();

      // Parallel audit writes — independent rows
      await Promise.all(
        outcomes.map((outcome) => {
          const requested = fixes.find((f) => f.field === outcome.field);
          return recordAuditEvent({
            shop,
            productId: gid,
            userId: auditUserId,
            attribute: outcome.field,
            oldValue: requested?.currentValue ?? null,
            newValue: requested?.newValue ?? null,
            reason: intent,
            success: outcome.success,
            error: outcome.error ?? null,
            meta: { verifiedValue: outcome.verifiedValue },
          });
        }),
      );

      logEvent({
        level: "info",
        event: "mutation.completed",
        productId: gid,
        durationMs: mutateMs,
        details: {
          intent,
          shopifyMutateMs: mutTimings.mutateMs,
          shopifyVerifyMs: mutTimings.verifyMs,
          outcomes: outcomes.map((o) => ({
            field: o.field,
            success: o.success,
            verifiedValue: o.verifiedValue,
            error: o.error ?? null,
          })),
          requested: fixes.map((f) => ({
            field: f.field,
            currentValue: f.currentValue ?? null,
            newValue: f.newValue,
          })),
        },
      });

      const anySuccess = outcomes.some((o) => o.success);
      let analysis: AnalysisResult | null = null;
      let timings: {
        productFetchMs: number;
        visionMs: number;
        pixelMs: number;
        consistencyMs: number;
        totalMs: number;
        cacheHit: boolean;
      } | null = null;
      let recheckMode:
        | "targeted-recheck"
        | "cached-recheck"
        | "full"
        | null = null;

      if (anySuccess && product) {
        // Fast path: targeted recheck — NO vision, NO image download
        const { recomputeAnalysisAfterFix } = await import(
          "../lib/post-fix-analysis.server"
        );
        const targeted = await recomputeAnalysisAfterFix({
          shop,
          product,
          admin,
          metafields,
        });
        if (targeted.ok) {
          analysis = targeted.analysis;
          recheckMode = "targeted-recheck";
          timings = {
            productFetchMs: 0,
            visionMs: 0,
            pixelMs: 0,
            consistencyMs: targeted.timings.consistencyMs,
            totalMs: targeted.timings.totalMs,
            cacheHit: true,
          };
        } else {
          // Cache miss only: listing-only recheck (still no vision if cache warms)
          // Never fall back to full vision on the Apply Fix request path.
          const recheck = await runListingRecheck(
            admin,
            gid,
            product,
            pipelineCtx,
          );
          if (recheck.ok && recheck.mode === "cached-recheck") {
            analysis = recheck.analysis;
            timings = recheck.timings;
            recheckMode = recheck.mode;
          } else {
            // Return mutation success without blocking on vision;
            // merchant can re-analyze if needed.
            logEvent({
              level: "warn",
              event: "mutation.recheck_deferred",
              productId: gid,
              details: {
                reason: targeted.reason,
                message:
                  "Apply Fix verified in Shopify; analysis refresh deferred (no vision on mutation path)",
              },
            });
          }
        }
      }

      logEvent({
        level: "info",
        event: "mutation.recheck",
        productId: gid,
        durationMs: Date.now() - started,
        details: {
          intent,
          recheckMode,
          cacheHit: timings?.cacheHit ?? false,
          successCount: outcomes.filter((o) => o.success).length,
          total: outcomes.length,
          totalMs: Date.now() - started,
          mutateMs,
        },
      });

      const normalized = product ? normalizeProduct(product) : null;

      if (intent === "applyAllFixes") {
        return {
          bulkFixResult: {
            outcomes,
            successCount: outcomes.filter((o) => o.success).length,
            total: outcomes.length,
            product: normalized,
          },
          analysis,
          timings,
          requestId,
        };
      }

      const primary = outcomes[0] as FixOutcome | undefined;
      if (!primary) {
        return { error: "No fix outcome returned", requestId };
      }
      if (!primary.success) {
        return {
          fixResult: {
            success: false,
            field: primary.field,
            verifiedValue: primary.verifiedValue,
            product: normalized,
            error: primary.error,
          },
          requestId,
        };
      }

      return {
        fixResult: {
          success: true,
          field: primary.field,
          verifiedValue: primary.verifiedValue,
          product: normalized,
        },
        analysis,
        timings,
        requestId,
      };
    } catch (err) {
      console.error("[guardian] applyFix failed:", err);
      return {
        error:
          err instanceof Error ? err.message : "Shopify mutation failed",
        requestId,
      };
    }
  }

  if (intent === "revert") {
    const field = String(formData.get("field") || "") as FixableSignal;
    const force = String(formData.get("force") || "") === "1";
    const allowedFields: FixableSignal[] = ALLOWED_FIX_FIELDS;
    if (!allowedFields.includes(field)) {
      return { error: `Unsupported revert field: ${field}`, requestId };
    }

    const { getLatestSuccessfulAudit, recordAuditEvent } = await import(
      "../lib/analysis-persist.server"
    );
    const { getShopSettings, toFixSettings } = await import(
      "../lib/shop-settings.server"
    );
    const audit = await getLatestSuccessfulAudit({
      shop,
      productId: gid,
      attribute: field,
    });
    if (!audit?.oldValue || !audit.newValue) {
      return {
        error: "No reversible mutation found for this attribute.",
        requestId,
      };
    }

    // Validate current Shopify state still matches the audited newValue
    const product = await fetchProductNode(admin, gid);
    if (!product) {
      return { error: "Product not found in Shopify.", requestId };
    }
    const { fetchProductSellenvoMetafields } = await import(
      "../lib/metafields.server"
    );
    const meta = await fetchProductSellenvoMetafields(admin, gid);
    const { extractListingFacts } = await import("../lib/consistency.server");
    const listing = extractListingFacts(product, meta);

    const currentValue = claimedValueForField(field, listing);

    const matchesAudited =
      (currentValue || "").toLowerCase().trim() ===
      audit.newValue.toLowerCase().trim();

    if (!matchesAudited && !force) {
      return {
        error: `Shopify value changed since the fix. Expected "${audit.newValue}" but found "${currentValue ?? "—"}". Revert would overwrite a newer merchant change.`,
        staleRevert: true,
        expectedValue: audit.newValue,
        currentValue: currentValue ?? null,
        oldValue: audit.oldValue,
        requestId,
      };
    }

    const shopSettings = await getShopSettings(shop);
    const fixSettings = toFixSettings(shopSettings);
    let optionId: string | undefined;
    let optionValueId: string | undefined;
    if (field === "color") {
      const opt = product.options.find(
        (o) =>
          o.name.toLowerCase() === "color" ||
          o.name.toLowerCase() === "colour",
      );
      optionId = opt?.id;
      optionValueId = opt?.optionValues[0]?.id;
    }

    const { outcomes, product: updated } = await applyShopifyFixes(
      admin,
      gid,
      [
        {
          field,
          newValue: audit.oldValue,
          currentValue: currentValue ?? undefined,
          optionId,
          optionValueId,
        },
      ],
      { settings: fixSettings, merchantConfirmed: true },
    );

    const outcome = outcomes[0];
    const onlineUser =
      session.onlineAccessInfo &&
      "associated_user" in session.onlineAccessInfo
        ? session.onlineAccessInfo.associated_user
        : null;
    const auditUserId =
      onlineUser && typeof onlineUser === "object" && "id" in onlineUser
        ? String(onlineUser.id)
        : session.id ?? null;

    await recordAuditEvent({
      shop,
      productId: gid,
      userId: auditUserId,
      attribute: field,
      oldValue: audit.newValue,
      newValue: audit.oldValue,
      reason: "revert",
      success: outcome?.success ?? false,
      error: outcome?.error ?? null,
      meta: {
        verifiedValue: outcome?.verifiedValue,
        priorAuditId: audit.id,
        forced: force,
      },
    });

    if (!outcome?.success) {
      return {
        error: outcome?.error || "Revert failed verification",
        requestId,
      };
    }

    return {
      revertResult: {
        success: true,
        field,
        restoredValue: audit.oldValue,
        verifiedValue: outcome.verifiedValue,
        product: updated ? normalizeProduct(updated) : normalizeProduct(product),
      },
      requestId,
    };
  }

  return { error: `Unknown intent: ${intent}`, requestId };
};

export default function GuardianPage() {
  const {
    product: initialProduct,
    loadError,
    analysis: loaderAnalysis,
    autoAnalyze: shouldAutoAnalyze,
    materialWriteMode,
  } =
    useLoaderData<typeof loader>();

  if (!initialProduct) {
    return (
      <s-page heading="Visual Listing Guardian">
        <s-link slot="breadcrumb-actions" href="/app">
          Catalog Health
        </s-link>
        <s-section heading="Couldn't load product">
          <s-banner tone="critical" heading="Shopify connection problem">
            <s-paragraph>
              {loadError ||
                "Could not reach Shopify Admin API. This is usually a temporary network or tunnel issue — not a product bug."}
            </s-paragraph>
            <s-paragraph>
              Try: refresh this page, re-open the app from Shopify Admin Preview,
              or restart `shopify app dev` (Cloudflare tunnels expire).
            </s-paragraph>
          </s-banner>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={() => window.location.reload()}>
              Retry
            </s-button>
            <s-button href="/app">Back to Catalog Health</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <GuardianContent
      initialProduct={initialProduct}
      initialAnalysis={loaderAnalysis}
      autoAnalyze={shouldAutoAnalyze}
      materialWriteMode={materialWriteMode}
    />
  );
}

function GuardianContent({
  initialProduct,
  initialAnalysis,
  autoAnalyze: shouldAutoAnalyze,
  materialWriteMode,
}: {
  initialProduct: ReturnType<typeof normalizeProduct>;
  initialAnalysis: import("../lib/types").AnalysisResult | null;
  autoAnalyze: boolean;
  materialWriteMode: "metafield" | "title" | "both";
}) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const fixModal = useFixModal();

  const [product, setProduct] = useState(initialProduct);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(
    initialAnalysis,
  );
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(
    initialAnalysis ? new Date().toISOString() : null,
  );
  const [showEvidence, setShowEvidence] = useState(false);
  const [pendingFix, setPendingFix] = useState<SuggestedFix | null>(null);
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [fixPhase, setFixPhase] = useState<FixPhase>("idle");
  const [activeFixField, setActiveFixField] = useState<FixableSignal | null>(
    null,
  );
  const [bulkProgress, setBulkProgress] = useState<FixOutcome[] | null>(null);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  const [seenFetcherData, setSeenFetcherData] = useState<typeof fetcher.data>(
    undefined,
  );
  const [latestRequestId, setLatestRequestId] = useState(0);
  const [autoAnalyzeToken, setAutoAnalyzeToken] = useState(0);
  const sideEffectDataRef = useRef<typeof fetcher.data>(undefined);
  const autoAnalyzeStartedForTokenRef = useRef<number | null>(null);

  const intent =
    fetcher.state !== "idle"
      ? String(fetcher.formData?.get("intent") || "")
      : "";
  const isAnalyzing = intent === "analyze" || intent === "recheck";
  const isFixing = intent === "applyFix" || intent === "applyAllFixes";
  const isAttachingImage = intent === "attachDemoImage";
  const busy = fetcher.state !== "idle";

  const nextRequestId = useCallback(() => {
    const id = latestRequestId + 1;
    setLatestRequestId(id);
    return String(id);
  }, [latestRequestId]);

  // Sync fetcher payloads into React state during render (not in an effect).
  if (fetcher.data !== seenFetcherData) {
    setSeenFetcherData(fetcher.data);
    const data = fetcher.data;
    const incoming =
      data && "requestId" in data && data.requestId
        ? Number(data.requestId)
        : NaN;
    const isStale =
      Number.isFinite(incoming) &&
      incoming > 0 &&
      incoming < latestRequestId;

    if (data && !isStale) {
      if ("analysis" in data && data.analysis) {
        setAnalysis(data.analysis);
        setAnalyzedAt(new Date().toISOString());
        setShowEvidence(false);
        setPendingFix(null);
        setModalKind(null);
        setFixPhase("idle");
        setActiveFixField(null);
      }
      if ("product" in data && data.product) {
        setProduct(data.product);
      }
      if ("imageAttached" in data && data.imageAttached) {
        setAnalysis(null);
        setAnalyzedAt(null);
        setAutoAnalyzeToken((t) => t + 1);
      }
      if ("fixResult" in data && data.fixResult?.product) {
        setProduct(data.fixResult.product);
        if (data.fixResult.success) {
          setFixPhase("idle");
          setActiveFixField(null);
        } else {
          setFixPhase("error");
          setActiveFixField(data.fixResult.field);
        }
      }
      if ("bulkFixResult" in data && data.bulkFixResult) {
        if (data.bulkFixResult.product) {
          setProduct(data.bulkFixResult.product);
        }
        setBulkProgress(data.bulkFixResult.outcomes);
        const { successCount, total } = data.bulkFixResult;
        setBulkSummary(`${successCount} of ${total} fixes applied`);
        setFixPhase(successCount === total ? "idle" : "error");
        setActiveFixField(null);
      }
    }
  }

  // Derived progress while a request is in flight (no fake stages).
  const livePhase: FixPhase =
    isFixing
      ? "updating"
      : intent === "recheck"
        ? "rechecking"
        : fixPhase;

  // Auto-analyze once per token when Guardian has a usable image and no analysis.
  useEffect(() => {
    // Loader may restore a prior analysis (skip). Token bumps (e.g. demo image) force a run.
    const allowAuto = shouldAutoAnalyze || autoAnalyzeToken > 0;
    if (!allowAuto) return;
    if (autoAnalyzeStartedForTokenRef.current === autoAnalyzeToken) return;
    if (!product.hasUsableImage) return;
    if (analysis) return;
    if (busy) return;
    autoAnalyzeStartedForTokenRef.current = autoAnalyzeToken;
    fetcher.submit(
      { intent: "analyze", requestId: `auto-${autoAnalyzeToken}` },
      { method: "POST" },
    );
  }, [
    shouldAutoAnalyze,
    autoAnalyzeToken,
    product.hasUsableImage,
    analysis,
    busy,
    fetcher,
  ]);

  // External systems: toasts + modal hide. Never alert(). Never setState here.
  useEffect(() => {
    if (!fetcher.data || fetcher.data === sideEffectDataRef.current) return;
    sideEffectDataRef.current = fetcher.data;
    const data = fetcher.data;

    if ("requestId" in data && data.requestId) {
      const incoming = Number(data.requestId);
      if (
        Number.isFinite(incoming) &&
        incoming > 0 &&
        incoming < latestRequestId
      ) {
        return;
      }
    }

    if ("imageAttached" in data && data.imageAttached) {
      shopify.toast.show("Demo image attached — analyzing…");
    }

    if (
      "analysis" in data &&
      data.analysis &&
      !("fixResult" in data) &&
      !("bulkFixResult" in data)
    ) {
      const issues = data.analysis.issues.filter(
        (i) => i.verdict === "MISMATCH",
      );
      shopify.toast.show(
        issues.length === 0
          ? "Analysis complete — listing looks healthy"
          : `Analysis complete — ${issues.length} issue${issues.length === 1 ? "" : "s"} found`,
      );
    }

    if ("fixResult" in data && data.fixResult) {
      fixModal.hide();
      const { success, field, verifiedValue, error } = data.fixResult as {
        success: boolean;
        field: FixableSignal;
        verifiedValue: string | null;
        error?: string;
      };
      if (success) {
        shopify.toast.show(
          `${fixFieldLabel(field)} updated to ${verifiedValue}`,
        );
      } else {
        shopify.toast.show(
          error || `Couldn't update ${fixFieldLabel(field)}. Try again.`,
          { isError: true },
        );
      }
    }

    if ("bulkFixResult" in data && data.bulkFixResult) {
      fixModal.hide();
      const { successCount, total } = data.bulkFixResult;
      if (successCount === total) {
        shopify.toast.show(`✓ ${successCount} fixes applied successfully`);
      } else if (successCount > 0) {
        shopify.toast.show(
          `${successCount} of ${total} fixes applied — ${total - successCount} need attention`,
          { isError: true },
        );
      } else {
        shopify.toast.show("Couldn't apply fixes. Try again.", {
          isError: true,
        });
      }
    }

    if ("error" in data && data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [fetcher.data, shopify, fixModal, latestRequestId]);

  const runAnalyze = useCallback(() => {
    setAnalysis(null);
    setAnalyzedAt(null);
    setPendingFix(null);
    setBulkProgress(null);
    setBulkSummary(null);
    const requestId = nextRequestId();
    fetcher.submit({ intent: "analyze", requestId, forceFull: "1" }, { method: "POST" });
  }, [fetcher, nextRequestId]);

  const attachDemoImage = useCallback(() => {
    fetcher.submit(
      { intent: "attachDemoImage", requestId: nextRequestId() },
      { method: "POST" },
    );
  }, [fetcher, nextRequestId]);

  const openConfirm = useCallback(
    (fix: SuggestedFix) => {
      if (busy) return;
      setPendingFix(fix);
      setModalKind("confirm");
      fixModal.show();
    },
    [fixModal, busy],
  );

  const openEdit = useCallback(
    (fix: SuggestedFix) => {
      if (busy) return;
      setPendingFix(fix);
      setModalKind("edit");
      fixModal.show();
    },
    [fixModal, busy],
  );

  const openApplyAll = useCallback(() => {
    if (busy || !analysis?.suggestedFixes.length) return;
    setPendingFix(null);
    setModalKind("applyAll");
    fixModal.show();
  }, [busy, analysis, fixModal]);

  const applySafeFixes = useCallback(() => {
    if (busy || !analysis?.suggestedFixes.length) return;
    // Safe mode: server filters to fixPolicy===safe && safeAutoFixEnabled
    setFixPhase("updating");
    setActiveFixField(null);
    setBulkProgress(
      analysis.suggestedFixes.map((f) => ({
        field: f.field,
        success: false,
        verifiedValue: null,
      })),
    );
    setBulkSummary("Applying safe fixes…");
    fetcher.submit(
      {
        intent: "applyAllFixes",
        applyMode: "safe",
        fixesJson: JSON.stringify(analysis.suggestedFixes),
        requestId: nextRequestId(),
      },
      { method: "POST" },
    );
  }, [busy, analysis, fetcher, nextRequestId]);

  const submitFix = useCallback(
    (fix: SuggestedFix, newValue: string) => {
      if (busy) return;
      setFixPhase("updating");
      setActiveFixField(fix.field);
      setBulkProgress(null);
      setBulkSummary(null);
      fetcher.submit(
        {
          intent: "applyFix",
          field: fix.field,
          productId: fix.productId,
          optionId: fix.optionId ?? "",
          optionValueId: fix.optionValueId ?? "",
          currentValue: fix.currentValue,
          newValue,
          requestId: nextRequestId(),
        },
        { method: "POST" },
      );
    },
    [busy, fetcher, nextRequestId],
  );

  const confirmModal = useCallback(
    (editValue?: string, selectedFixes?: SuggestedFix[]) => {
      if (busy) return;
      if (modalKind === "applyAll" && analysis) {
        const toApply =
          selectedFixes && selectedFixes.length > 0
            ? selectedFixes
            : analysis.suggestedFixes;
        if (toApply.length === 0) return;
        setFixPhase("updating");
        setActiveFixField(null);
        setBulkProgress(
          toApply.map((f) => ({
            field: f.field,
            success: false,
            verifiedValue: null,
          })),
        );
        setBulkSummary(`Applying ${toApply.length} selected fix${toApply.length === 1 ? "" : "es"}…`);
        fetcher.submit(
          {
            intent: "applyAllFixes",
            applyMode: "confirm",
            fixesJson: JSON.stringify(toApply),
            requestId: nextRequestId(),
          },
          { method: "POST" },
        );
        return;
      }
      if (!pendingFix) return;
      const value =
        modalKind === "edit"
          ? (editValue || "").trim()
          : pendingFix.suggestedValue;
      if (!value) return;
      submitFix(pendingFix, value);
    },
    [busy, modalKind, analysis, pendingFix, fetcher, nextRequestId, submitFix],
  );

  const retryFailed = useCallback(
    (field: FixableSignal) => {
      const fromBulk = analysis?.suggestedFixes.find((f) => f.field === field);
      const failed = bulkProgress?.find((o) => o.field === field && !o.success);
      if (fromBulk) {
        openConfirm(fromBulk);
        return;
      }
      if (failed && analysis) {
        const fix = analysis.suggestedFixes.find((f) => f.field === field);
        if (fix) openConfirm(fix);
      }
    },
    [analysis, bulkProgress, openConfirm],
  );

  const overallBand =
    analysis == null
      ? null
      : analysis.overallConfidence >= 0.85
        ? "High"
        : analysis.overallConfidence >= 0.55
          ? "Medium"
          : "Low";

  const bannerTone =
    analysis?.overallVerdict === "MATCH"
      ? "success"
      : analysis?.overallVerdict === "MISMATCH"
        ? "warning"
        : analysis?.overallVerdict === "UNCERTAIN"
          ? "info"
          : undefined;

  const analysisError =
    fetcher.data && "error" in fetcher.data && fetcher.data.error && !analysis
      ? fetcher.data.error
      : null;

  return (
    <s-page heading="Visual Listing Guardian">
      <s-link slot="breadcrumb-actions" href="/app">
        Catalog Health
      </s-link>

      <s-section heading={product.title}>
        <s-stack direction="block" gap="base">
          {(!product.hasUsableImage || !product.imageUrl) && (
            <s-banner tone="warning" heading="Need a real product photo">
              This product has no usable image yet (blank Shopify placeholder).
              Click <s-text type="strong">Attach black wallet demo image</s-text>{" "}
              — we upload via Shopify staged upload (more reliable than remote
              URL fetch). Or add a photo in Admin → Products.
            </s-banner>
          )}

          <s-stack direction="inline" gap="base">
            {product.hasUsableImage && product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                width={160}
                height={160}
                style={{
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                }}
              />
            ) : (
              <s-box
                padding="large"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-text>Blank / placeholder image</s-text>
                  {product.imageUrl ? (
                    <s-text>
                      Detected placeholder URL — replace it with a real photo.
                    </s-text>
                  ) : (
                    <s-text>No media on this product yet.</s-text>
                  )}
                </s-stack>
              </s-box>
            )}
            <s-stack direction="block" gap="small">
              <s-paragraph>
                <s-text type="strong">Color: </s-text>
                <s-text>{product.claimedColor ?? "Not set"}</s-text>
              </s-paragraph>
              {product.colorVariantCount > 1 ? (
                <s-banner tone="warning" heading="Checking first color only">
                  <s-paragraph>
                    This product has {product.colorVariantCount}{" "}
                    {product.colorOptionName || "Color"} values. Sellenvo
                    currently compares and can fix the first value (
                    {product.claimedColor}) only — not every variant.
                  </s-paragraph>
                </s-banner>
              ) : null}
              <s-paragraph>
                <s-text type="strong">Type: </s-text>
                <s-text>{product.productType || "—"}</s-text>
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Material: </s-text>
                <s-text>{product.claimedMaterial ?? "—"}</s-text>
              </s-paragraph>
            </s-stack>
          </s-stack>

          <s-stack direction="inline" gap="base">
            <s-button
              onClick={attachDemoImage}
              disabled={isFixing}
              {...(isAttachingImage ? { loading: true } : {})}
            >
              {product.hasUsableImage
                ? "Replace with black wallet demo image"
                : "Attach black wallet demo image"}
            </s-button>
            <s-button
              variant="primary"
              onClick={runAnalyze}
              disabled={!product.hasUsableImage || isAttachingImage || isFixing}
              {...(isAnalyzing && fixPhase !== "updating" ? { loading: true } : {})}
            >
              {analysis ? "Re-analyze" : "Analyze Product"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {livePhase !== "idle" && livePhase !== "error" && livePhase !== "done" && (
        <s-section heading="Progress">
          <s-banner
            tone="info"
            heading={
              livePhase === "updating"
                ? "Updating Shopify…"
                : "Refreshing listing consistency…"
            }
          >
            {livePhase === "updating"
              ? "Shopify is saving your change. The rest of this page stays usable."
              : "Comparing updated listing fields to the existing visual analysis."}
          </s-banner>
        </s-section>
      )}

      {bulkSummary && bulkProgress && (
        <s-section heading="Apply All progress">
          <s-stack direction="block" gap="base">
            <s-text type="strong">{bulkSummary}</s-text>
            {bulkProgress.map((o) => (
              <s-paragraph key={o.field}>
                {o.success ? "✓" : livePhase === "updating" ? "⟳" : "✕"}{" "}
                {fixFieldLabel(o.field)}
                {!o.success && o.error ? ` — ${o.error}` : ""}
                {!o.success && livePhase !== "updating" && (
                  <>
                    {" "}
                    <s-button
                      variant="tertiary"
                      onClick={() => retryFailed(o.field)}
                      disabled={busy}
                    >
                      Retry
                    </s-button>
                  </>
                )}
              </s-paragraph>
            ))}
          </s-stack>
        </s-section>
      )}

      {analysisError && !isAnalyzing && (
        <s-section heading="Analysis Error">
          <s-banner
            tone={
              /rate limit|token limit|Groq daily/i.test(analysisError)
                ? "warning"
                : "critical"
            }
            heading={
              /rate limit|token limit|Groq daily/i.test(analysisError)
                ? "Vision quota reached"
                : "Analysis couldn't be completed"
            }
          >
            <s-paragraph>{analysisError}</s-paragraph>
            {/rate limit|token limit|Groq daily/i.test(analysisError) ? (
              <s-paragraph>
                Open this product again to use the last cached analysis, or wait
                for the daily Groq reset (~17 min from the API message). Do not
                spam Re-analyze — each attempt uses more quota.
              </s-paragraph>
            ) : (
              <s-button variant="primary" onClick={runAnalyze}>
                Retry Analysis
              </s-button>
            )}
          </s-banner>
        </s-section>
      )}

      {isAnalyzing && !analysis && (
        <s-section heading="Analyzing product…">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-spinner accessibilityLabel="Analyzing product image" />
              <s-stack direction="block" gap="small">
                <s-text type="strong">Vision model running</s-text>
                <s-text>
                  Sending the product image URL to Groq (usually 5–25s). Image
                  download and listing compare run in parallel.
                </s-text>
                <s-text tone="neutral">
                  Re-opening this product later is instant — we reuse the last
                  vision result until you click Re-analyze.
                </s-text>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {analysis && (
        <s-section heading="Listing Health">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text type="strong">
                Listing Health: {analysis.healthScore} / 100
              </s-text>
              {overallBand !== null && (
                <s-badge tone={verdictTone(analysis.overallVerdict)}>
                  {overallBand} confidence
                </s-badge>
              )}
              {analysis.analysisSource === "cached-recheck" && (
                <s-badge tone="info">Fast recheck (vision reused)</s-badge>
              )}
              {analyzedAt && (
                <s-badge tone="info">
                  Last analyzed:{" "}
                  {new Date(analyzedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </s-badge>
              )}
              {fetcher.data &&
                "timings" in fetcher.data &&
                fetcher.data.timings && (
                  <s-badge tone="info">
                    {fetcher.data.timings.cacheHit
                      ? `Recheck ${fetcher.data.timings.totalMs}ms`
                      : `Vision ${fetcher.data.timings.visionMs}ms · total ${fetcher.data.timings.totalMs}ms`}
                  </s-badge>
                )}
            </s-stack>

            {bannerTone && (
              <s-banner
                tone={bannerTone}
                heading={
                  analysis.overallVerdict === "MATCH"
                    ? "Listing appears visually consistent"
                    : analysis.overallVerdict === "MISMATCH"
                      ? "Visual inconsistency detected"
                      : "Visual validation is inconclusive"
                }
              />
            )}

            {analysis.imageQualityNote && (
              <s-banner
                tone={analysis.imageQuality === "poor" ? "warning" : "info"}
                heading="Image quality"
              >
                {analysis.imageQualityNote}
              </s-banner>
            )}

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-heading>Issues & signals</s-heading>
                {analysis.signalResults.length === 0 ? (
                  <s-paragraph>
                    No signals could be evaluated for this listing.
                  </s-paragraph>
                ) : (
                  analysis.signalResults.map((sr) => {
                    const swatchKey = (sr.detected ?? "").toLowerCase();
                    const claimedSwatch = (sr.claimed ?? "").toLowerCase();
                    const fix = analysis.suggestedFixes.find(
                      (f) => f.field === sr.signal,
                    );
                    const applyingThis =
                      isFixing && activeFixField === sr.signal;
                    return (
                      <s-box
                        key={sr.signal}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <s-stack direction="block" gap="small">
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } satisfies CSSProperties}>
                            <s-text type="strong">
                              {signalLabel(sr.signal)}
                            </s-text>
                            <s-badge tone={verdictTone(sr.verdict)}>
                              {sr.verdict === "MISMATCH"
                                ? "Mismatch"
                                : sr.verdict === "MATCH"
                                  ? "Match"
                                  : sr.verdict === "UNCERTAIN"
                                    ? "Uncertain"
                                    : sr.verdict === "NOT_DETECTABLE"
                                      ? "Not detectable"
                                      : sr.verdict === "NOT_APPLICABLE"
                                        ? "Not applicable"
                                        : sr.verdict}
                            </s-badge>
                            <s-badge>
                              {sr.confidence !== null
                                ? sr.confidence >= 0.85
                                  ? "High confidence"
                                  : sr.confidence >= 0.55
                                    ? "Medium confidence"
                                    : "Low confidence"
                                : "—"}
                            </s-badge>
                          </div>
                          <s-paragraph>
                            <s-text type="strong">Shopify says: </s-text>
                            {sr.claimed ?? "—"}
                          </s-paragraph>
                          <s-paragraph>
                            <s-text type="strong">Vision detected: </s-text>
                            <s-stack direction="inline" gap="small">
                              {sr.signal === "color" &&
                                claimedSwatch &&
                                COLOR_SWATCHES[claimedSwatch] && (
                                  <span
                                    role="img"
                                    aria-label={`Listed color ${sr.claimed}`}
                                    title={`Listed: ${sr.claimed}`}
                                    style={{
                                      display: "inline-block",
                                      width: 16,
                                      height: 16,
                                      borderRadius: "50%",
                                      backgroundColor:
                                        COLOR_SWATCHES[claimedSwatch],
                                      border: "1px solid #ccc",
                                    }}
                                  />
                                )}
                              {sr.signal === "color" &&
                                swatchKey &&
                                COLOR_SWATCHES[swatchKey] && (
                                  <span
                                    role="img"
                                    aria-label={`Detected color ${sr.detected}`}
                                    title={`Detected: ${sr.detected}`}
                                    style={{
                                      display: "inline-block",
                                      width: 16,
                                      height: 16,
                                      borderRadius: "50%",
                                      backgroundColor:
                                        COLOR_SWATCHES[swatchKey],
                                      border: "1px solid #ccc",
                                    }}
                                  />
                                )}
                              <s-text>{sr.detected ?? "—"}</s-text>
                            </s-stack>
                          </s-paragraph>
                          <s-paragraph>
                            <s-text type="strong">Evidence: </s-text>
                            {sr.evidence}
                          </s-paragraph>

                          {fix && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties}>
                              <s-button
                                variant="primary"
                                onClick={() => openConfirm(fix)}
                                disabled={busy && !applyingThis}
                                {...(applyingThis ? { loading: true } : {})}
                              >
                                {applyingThis
                                  ? livePhase === "rechecking"
                                    ? "Verifying…"
                                    : "Updating…"
                                  : "Apply Fix"}
                              </s-button>
                              <s-button
                                onClick={() => openEdit(fix)}
                                disabled={busy}
                              >
                                Edit
                              </s-button>
                            </div>
                          )}
                        </s-stack>
                      </s-box>
                    );
                  })
                )}
                <s-paragraph>
                  <s-text type="strong">Image quality: </s-text>
                  <s-text>{analysis.imageQuality}</s-text>
                </s-paragraph>
              </s-stack>
            </s-box>

            <s-stack direction="inline" gap="base">
              <s-button
                variant="tertiary"
                onClick={() => setShowEvidence((v) => !v)}
              >
                {showEvidence ? "Hide Evidence" : "View Evidence"}
              </s-button>
            </s-stack>

            {showEvidence && (
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>Evidence</s-heading>
                  {analysis.imageUrl && (
                    <s-thumbnail
                      src={analysis.imageUrl}
                      alt="Analyzed product"
                      size="large"
                    />
                  )}
                  <s-paragraph>
                    <s-text type="strong">Vision reasoning: </s-text>
                    {analysis.visionReasoning}
                  </s-paragraph>
                  {analysis.issues.map((issue) => (
                    <s-paragraph key={`${issue.signal}-${issue.verdict}`}>
                      <s-text type="strong">
                        {signalLabel(issue.signal)} ({issue.verdict}):{" "}
                      </s-text>
                      {issue.evidence}
                    </s-paragraph>
                  ))}
                  <s-paragraph>
                    <s-text type="strong">Confidence: </s-text>
                    {overallBand} (model signal, not measured accuracy)
                  </s-paragraph>
                </s-stack>
              </s-box>
            )}

            <s-stack direction="inline" gap="base">
              <s-button
                onClick={() =>
                  fetcher.submit(
                    {
                      intent: "visionFeedback",
                      note: "Vision was wrong",
                      requestId: nextRequestId(),
                    },
                    { method: "POST" },
                  )
                }
                disabled={busy}
              >
                Vision was wrong
              </s-button>
            </s-stack>

            {analysis.suggestedFixes.length > 0 && (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-heading>Suggested actions</s-heading>
                  <s-paragraph>
                    Confirm each change, edit a value manually, or apply all
                    confirmed fixes in one batch. Safe auto-fix stays off unless
                    enabled in Settings.
                  </s-paragraph>
                  {analysis.suggestedFixes.map((fix) => {
                    const applyingThis =
                      isFixing && activeFixField === fix.field;
                    return (
                      <s-box
                        key={fix.field}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        background="subdued"
                      >
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } satisfies CSSProperties}>
                          <s-text type="strong">
                            {fixFieldLabel(fix.field)}
                          </s-text>
                          <s-text>
                            Listing says: {fix.currentValue} → Image shows:{" "}
                            {fix.suggestedValue}
                          </s-text>
                          <s-button
                            variant="primary"
                            onClick={() => openConfirm(fix)}
                            disabled={busy && !applyingThis}
                            {...(applyingThis ? { loading: true } : {})}
                          >
                            {applyingThis
                              ? livePhase === "rechecking"
                                ? "Verifying…"
                                : "Updating…"
                              : "Apply Fix"}
                          </s-button>
                          <s-button
                            onClick={() => openEdit(fix)}
                            disabled={busy}
                          >
                            Edit
                          </s-button>
                        </div>
                      </s-box>
                    );
                  })}
                  {analysis.suggestedFixes.length > 1 && (
                    <s-stack direction="inline" gap="base">
                      <s-button
                        onClick={applySafeFixes}
                        disabled={busy}
                        {...(intent === "applyAllFixes" ? { loading: true } : {})}
                      >
                        Apply all safe fixes
                      </s-button>
                      <s-button
                        variant="primary"
                        onClick={openApplyAll}
                        disabled={busy}
                      >
                        Review & apply selected ({analysis.suggestedFixes.length})
                      </s-button>
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-section>
      )}

      {modalKind && (
        <FixModal
          open={fixModal.open}
          mode={modalKind}
          field={pendingFix?.field}
          currentValue={pendingFix?.currentValue}
          suggestedValue={pendingFix?.suggestedValue}
          fixes={analysis?.suggestedFixes}
          loading={isFixing}
          materialWriteMode={materialWriteMode}
          onCancel={() => {
            if (isFixing) return;
            fixModal.hide();
            setModalKind(null);
            setPendingFix(null);
          }}
          onConfirm={confirmModal}
        />
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
