import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DEMO_BLACK_WALLET_IMAGE_URL } from "../lib/demo-assets";
import { uploadRemoteImageToProduct } from "../lib/attach-demo-image.server";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import {
  EMPTY_LISTING_ATTRIBUTES,
  apparelListingDefaults,
  bottleListingDefaults,
  handbagListingDefaults,
  listingAttributeFieldsForProductType,
  listingAttributesForSubmit,
  pruneListingAttributesForProductType,
  type ListingAttributeDraft,
} from "../lib/listing-attribute-form";

/**
 * Prefer a clearly black wallet when available. Wikimedia may be blocked from
 * Shopify media fetchers — merchant can replace the image in Admin after seed.
 */
const DEMO_BLACK_IMAGE =
  process.env.DEMO_BLACK_WALLET_IMAGE_URL || DEMO_BLACK_WALLET_IMAGE_URL;

const LIST_PRODUCTS_QUERY = `#graphql
  query GuardianListProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          title
          description
          productType
          status
          options {
            name
            optionValues { name }
          }
          media(first: 1) {
            nodes {
              ... on MediaImage {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }
    }
  }
`;

function productNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

function claimedColor(
  options: Array<{ name: string; optionValues: Array<{ name: string }> }>,
): string | null {
  return (
    options.find(
      (o) =>
        o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
    )?.optionValues[0]?.name ?? null
  );
}

function toDescriptionHtml(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "";
  // Escape basic HTML then wrap paragraphs
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "attention";
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = 25;
  const catalogCursor = url.searchParams.get("catalogCursor") || null;
  const catalogPageSize = 25;

  const verdictFilter =
    filter === "attention"
      ? ("MISMATCH" as const)
      : filter === "uncertain"
        ? ("UNCERTAIN" as const)
        : filter === "healthy"
          ? ("MATCH" as const)
          : ("all" as const);

  const { summarizeCatalogHealth, listCatalogHealth } = await import(
    "../lib/analysis-persist.server"
  );
  const { listScanJobs, isShopPaused } = await import("../lib/jobs.server");

  // Persist-first Inbox: never analyze on render. Parallelize independent reads.
  const inboxStarted = Date.now();
  const dbStarted = Date.now();
  const [health, analyses, jobs, productsResponse] = await Promise.all([
    summarizeCatalogHealth(session.shop),
    listCatalogHealth(session.shop, {
      take: pageSize,
      skip: (page - 1) * pageSize,
      verdict: verdictFilter,
    }),
    listScanJobs(session.shop, { take: 20 }),
    admin.graphql(LIST_PRODUCTS_QUERY, {
      variables: {
        first: catalogPageSize,
        after: catalogCursor,
      },
    }),
  ]);
  const parallelMs = Date.now() - dbStarted;
  const inboxLoadMs = Date.now() - inboxStarted;

  const json = await productsResponse.json();
  const edges = json.data?.products?.edges ?? [];
  const pageInfo = json.data?.products?.pageInfo ?? {
    hasNextPage: false,
    endCursor: null,
  };

  const products = edges.map(
    (edge: {
      node: {
        id: string;
        title: string;
        description: string | null;
        productType: string | null;
        status: string;
        options: Array<{
          name: string;
          optionValues: Array<{ name: string }>;
        }>;
        media: {
          nodes: Array<{
            image?: { url: string; altText?: string | null } | null;
          }>;
        };
      };
    }) => {
      const node = edge.node;
      return {
        id: node.id,
        numericId: productNumericId(node.id),
        title: node.title,
        description: node.description ?? "",
        productType: node.productType,
        status: node.status,
        color: claimedColor(node.options),
        imageUrl: node.media?.nodes?.[0]?.image?.url ?? null,
      };
    },
  );

  const { logEvent } = await import("../lib/logger.server");
  logEvent({
    level: "info",
    event: "route.catalog.loader",
    durationMs: inboxLoadMs,
    details: {
      parallelMs,
      productCount: products.length,
      analysisCount: analyses.length,
      jobCount: jobs.length,
      filter,
      page,
      healthLoadMs: health.loadMs,
      catalogCursor: catalogCursor ? "set" : null,
    },
  });

  return {
    products,
    health,
    analyses,
    jobs,
    shop: session.shop,
    filter,
    page,
    pageSize,
    inboxLoadMs,
    catalogPageInfo: {
      hasNextPage: Boolean(pageInfo.hasNextPage),
      endCursor: pageInfo.endCursor as string | null,
      cursor: catalogCursor,
    },
    jobsPaused: isShopPaused(session.shop),
  };
};

async function createProductWithColorAndMedia(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  args: {
    title: string;
    descriptionHtml?: string;
    productType: string;
    color: string;
    imageUrl?: string | null;
    imageAlt?: string;
  },
) {
  const productInput: Record<string, unknown> = {
    title: args.title,
    productType: args.productType || undefined,
    status: "ACTIVE",
  };
  if (args.descriptionHtml) {
    productInput.descriptionHtml = args.descriptionHtml;
  }

  const createRes = await admin.graphql(
    `#graphql
    mutation CreateTestProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        userErrors { field message }
        product { id title }
      }
    }`,
    { variables: { product: productInput } },
  );
  const createJson = await createRes.json();
  const createErrors = createJson.data?.productCreate?.userErrors ?? [];
  if (createErrors.length) {
    return {
      error: createErrors.map((e: { message: string }) => e.message).join("; "),
    };
  }
  const productId = createJson.data?.productCreate?.product?.id as
    | string
    | undefined;
  if (!productId) {
    return { error: "productCreate returned no product id" };
  }

  const optionsRes = await admin.graphql(
    `#graphql
    mutation CreateTestProductOptions($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $productId, options: $options) {
        userErrors { field message }
        product {
          id
          options {
            id
            name
            optionValues { id name }
          }
        }
      }
    }`,
    {
      variables: {
        productId,
        options: [
          {
            name: "Color",
            values: [{ name: args.color }],
          },
        ],
      },
    },
  );
  const optionsJson = await optionsRes.json();
  const optionErrors =
    optionsJson.data?.productOptionsCreate?.userErrors ?? [];
  if (optionErrors.length) {
    return {
      error: optionErrors
        .map((e: { message: string }) => e.message)
        .join("; "),
      productId,
    };
  }

  let mediaWarning: string | null = null;
  if (args.imageUrl) {
    const uploaded = await uploadRemoteImageToProduct(
      admin,
      productId,
      args.imageUrl,
      args.imageAlt || args.title,
    );
    if (!uploaded.ok) {
      mediaWarning = uploaded.error;
    }
  }

  const refreshRes = await admin.graphql(
    `#graphql
    query RefreshCreatedProduct($id: ID!) {
      product(id: $id) {
        id
        options {
          id
          name
          optionValues { id name }
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const refreshJson = await refreshRes.json();
  const product = refreshJson.data?.product ?? optionsJson.data?.productOptionsCreate?.product;
  const colorOption = product?.options?.find(
    (o: { name: string }) =>
      o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
  );

  return {
    created: {
      productId,
      numericId: productNumericId(productId),
      title: args.title,
      color: args.color,
      productType: args.productType,
      optionId: colorOption?.id ?? null,
      optionValueId: colorOption?.optionValues?.[0]?.id ?? null,
      mediaWarning,
    },
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "bulkScan") {
    const { enqueueScanJob } = await import("../lib/jobs.server");
    const productIds = String(formData.get("productIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let queued = 0;
    let deduped = 0;
    for (const id of productIds.slice(0, 50)) {
      const gid = id.startsWith("gid://")
        ? id
        : `gid://shopify/Product/${id}`;
      const result = await enqueueScanJob({
        shop: session.shop,
        productId: gid,
      });
      if (result.deduped) deduped += 1;
      else queued += 1;
    }
    return { bulkScan: { queued, deduped } };
  }

  if (intent === "retryFailedJobs") {
    const { listScanJobs, enqueueScanJob } = await import("../lib/jobs.server");
    const failed = await listScanJobs(session.shop, {
      status: "failed",
      take: 20,
    });
    let retried = 0;
    for (const job of failed) {
      await enqueueScanJob({
        shop: session.shop,
        productId: job.productId,
        listingFp: `retry-${Date.now()}-${job.id}`,
        priority: 2,
      });
      retried += 1;
    }
    return { retried };
  }

  if (intent === "seedDemoB") {
    try {
      const result = await createProductWithColorAndMedia(admin, {
        title: "Red Leather Wallet",
        descriptionHtml: toDescriptionHtml(
          "Demo listing claims Red leather. Attach a black wallet image to create the golden-path mismatch.",
        ),
        productType: "Wallet",
        color: "Red",
        imageUrl: DEMO_BLACK_IMAGE,
        imageAlt:
          "Demo wallet image — replace with a clearly BLACK wallet for the golden path",
      });
      if ("error" in result) {
        return { error: result.error ?? "Failed to seed demo product" };
      }
      const createdProduct = result.created;
      return {
        seeded: {
          productId: createdProduct.productId,
          numericId: createdProduct.numericId,
          title: createdProduct.title,
          color: createdProduct.color,
          productType: createdProduct.productType,
          optionId: createdProduct.optionId,
          optionValueId: createdProduct.optionValueId,
          mediaWarning: createdProduct.mediaWarning,
          note: "Replace the product image with a clearly BLACK wallet photo in Admin if the attached image is blank.",
        },
      };
    } catch (err) {
      console.error("[seedDemoB]", err);
      return {
        error:
          err instanceof Error ? err.message : "Failed to seed demo product",
      };
    }
  }

  if (intent === "seedDemoCatalog") {
    // Explicitly labeled demo data — diverse catalog integrity cases
    const demos = [
      {
        key: "match",
        title: "[Demo] Black Leather Wallet (Correct)",
        productType: "Wallet",
        color: "Black",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Correct listing — black image matches Black color",
      },
      {
        key: "color",
        title: "[Demo] Red Leather Wallet",
        productType: "Wallet",
        color: "Red",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Color mismatch — listed Red, image is black",
      },
      {
        key: "material",
        title: "[Demo] Plastic Wallet",
        productType: "Wallet",
        color: "Black",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Material mismatch candidate — listed Plastic, image often looks leather",
      },
      {
        key: "type",
        title: "[Demo] Travel Bag",
        productType: "Bag",
        color: "Black",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Product type mismatch candidate — listed Bag, image is wallet-like",
      },
      {
        key: "missing",
        title: "[Demo] Leather Wallet (No Image)",
        productType: "Wallet",
        color: "Brown",
        imageUrl: null,
        note: "Missing image — analysis should fail gracefully",
      },
      {
        key: "apparel",
        title: "[Demo] Cotton Crew Shirt",
        productType: "Apparel",
        color: "Blue",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Apparel pack — sleeve/neckline/closure claims",
      },
      {
        key: "footwear",
        title: "[Demo] Canvas Sneaker",
        productType: "Shoe",
        color: "White",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Footwear pack — shoe style / closure claims",
      },
      {
        key: "bag",
        title: "[Demo] Crossbody Handbag",
        productType: "Handbag",
        color: "Black",
        imageUrl: DEMO_BLACK_IMAGE,
        note: "Bags pack — strap / closure claims",
      },
    ];

    const created: Array<{
      key: string;
      productId: string;
      numericId: string;
      title: string;
      note: string;
    }> = [];
    const errors: string[] = [];

    for (const demo of demos) {
      try {
        const result = await createProductWithColorAndMedia(admin, {
          title: demo.title,
          descriptionHtml: toDescriptionHtml(
            `DEMO DATA — ${demo.note}. Not a real merchant product.`,
          ),
          productType: demo.productType,
          color: demo.color,
          imageUrl: demo.imageUrl,
          imageAlt: `Demo: ${demo.key}`,
        });
        if ("error" in result) {
          errors.push(`${demo.key}: ${result.error}`);
          continue;
        }
        created.push({
          key: demo.key,
          productId: result.created.productId,
          numericId: result.created.numericId,
          title: result.created.title,
          note: demo.note,
        });
      } catch (err) {
        errors.push(
          `${demo.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      demoCatalog: {
        created,
        errors,
        label: "DEMO DATA",
      },
    };
  }

  if (intent === "seedExperimentalAttrs") {
    try {
      const { seedExperimentalDummyMetafields } = await import(
        "../lib/seed-experimental-metafields.server"
      );
      const { enqueueScanJob } = await import("../lib/jobs.server");
      const result = await seedExperimentalDummyMetafields({
        admin,
        shop: session.shop,
      });
      let queued = 0;
      for (const productId of result.productIds) {
        const enq = await enqueueScanJob({
          shop: session.shop,
          productId,
        });
        if (!enq.deduped) queued += 1;
      }
      return { experimentalSeed: { ...result, scansQueued: queued } };
    } catch (err) {
      console.error("[seedExperimentalAttrs]", err);
      return {
        error:
          err instanceof Error
            ? err.message
            : "Failed to seed experimental attributes",
      };
    }
  }

  if (intent === "pauseJobs") {
    const { pauseShopJobs } = await import("../lib/jobs.server");
    pauseShopJobs(session.shop);
    return { jobsPaused: true };
  }

  if (intent === "resumeJobs") {
    const { resumeShopJobs } = await import("../lib/jobs.server");
    resumeShopJobs(session.shop);
    return { jobsPaused: false };
  }

  if (intent === "cancelAllJobs") {
    const { cancelAllQueuedJobs } = await import("../lib/jobs.server");
    const result = await cancelAllQueuedJobs(session.shop);
    return { cancelledJobs: result.cancelled };
  }

  if (intent === "createTestProduct") {
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const productType = String(formData.get("productType") || "").trim();
    const color = String(formData.get("color") || "").trim();
    const imageUrl = String(formData.get("imageUrl") || "").trim();
    const material = String(formData.get("material") || "").trim();
    const pattern = String(formData.get("pattern") || "").trim();
    const finish = String(formData.get("finish") || "").trim();
    const sleeveType = String(formData.get("sleeveType") || "").trim();
    const neckline = String(formData.get("neckline") || "").trim();
    const closureType = String(formData.get("closureType") || "").trim();
    const shoeStyle = String(formData.get("shoeStyle") || "").trim();
    const strapType = String(formData.get("strapType") || "").trim();

    if (!title) {
      return { error: "Title is required" };
    }
    if (!color) {
      return { error: "Color is required (used as the Color option value)" };
    }

    try {
      const result = await createProductWithColorAndMedia(admin, {
        title,
        descriptionHtml: toDescriptionHtml(description),
        productType: productType || "General",
        color,
        imageUrl: imageUrl || null,
        imageAlt: title,
      });
      if ("error" in result) {
        return { error: result.error ?? "Failed to create product" };
      }
      const createdProduct = result.created;

      const metafieldWrites: Array<{ key: string; value: string }> = [];
      if (material) metafieldWrites.push({ key: "material", value: material });
      if (pattern) metafieldWrites.push({ key: "pattern", value: pattern });
      if (finish) metafieldWrites.push({ key: "finish", value: finish });
      if (sleeveType) {
        metafieldWrites.push({ key: "sleeveType", value: sleeveType });
      }
      if (neckline) metafieldWrites.push({ key: "neckline", value: neckline });
      if (closureType) {
        metafieldWrites.push({ key: "closureType", value: closureType });
      }
      if (shoeStyle) metafieldWrites.push({ key: "shoeStyle", value: shoeStyle });
      if (strapType) metafieldWrites.push({ key: "strapType", value: strapType });

      const experimentalProvided = Boolean(
        pattern ||
          finish ||
          sleeveType ||
          neckline ||
          closureType ||
          shoeStyle ||
          strapType,
      );

      if (metafieldWrites.length > 0) {
        const {
          ensureSellenvoMetafieldDefinitions,
          setProductSellenvoMetafield,
        } = await import("../lib/metafields.server");
        await ensureSellenvoMetafieldDefinitions(admin);
        for (const write of metafieldWrites) {
          await setProductSellenvoMetafield(
            admin,
            createdProduct.productId,
            write.key as
              | "material"
              | "pattern"
              | "finish"
              | "sleeveType"
              | "neckline"
              | "closureType"
              | "shoeStyle"
              | "strapType",
            write.value,
          );
        }
      }

      if (experimentalProvided) {
        const { upsertShopSettings } = await import(
          "../lib/shop-settings.server"
        );
        await upsertShopSettings(session.shop, {
          showExperimentalAttributes: true,
        });
      }

      const claimSummary = [
        material && `Material=${material}`,
        pattern && `Pattern=${pattern}`,
        finish && `Finish=${finish}`,
        sleeveType && `Sleeve=${sleeveType}`,
        neckline && `Neckline=${neckline}`,
        closureType && `Closure=${closureType}`,
        shoeStyle && `Shoe style=${shoeStyle}`,
        strapType && `Strap=${strapType}`,
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        created: {
          productId: createdProduct.productId,
          numericId: createdProduct.numericId,
          title: createdProduct.title,
          color: createdProduct.color,
          productType: createdProduct.productType,
          optionId: createdProduct.optionId,
          optionValueId: createdProduct.optionValueId,
          mediaWarning: createdProduct.mediaWarning,
          claims: claimSummary || null,
          note: imageUrl
            ? "Listing claims saved. Open Guardian to run AI comparison against the photo."
            : "Listing claims saved. Add a product photo, then open Guardian to run AI comparison.",
        },
      };
    } catch (err) {
      console.error("[createTestProduct]", err);
      return {
        error:
          err instanceof Error ? err.message : "Failed to create test product",
      };
    }
  }

  if (intent === "deleteProduct") {
    const productId = String(formData.get("productId") || "").trim();
    const productTitle = String(formData.get("productTitle") || "").trim();
    if (!productId) {
      return { error: "Missing productId" };
    }
    const gid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    try {
      const deleteRes = await admin.graphql(
        `#graphql
        mutation DeleteTestProduct($id: ID!) {
          productDelete(input: { id: $id }) {
            deletedProductId
            userErrors { field message }
          }
        }`,
        { variables: { id: gid } },
      );
      const deleteJson = await deleteRes.json();
      const payload = deleteJson.data?.productDelete;
      const userErrors = payload?.userErrors ?? [];
      if (userErrors.length) {
        return {
          error: userErrors
            .map((e: { message: string }) => e.message)
            .join("; "),
        };
      }
      if (!payload?.deletedProductId) {
        return { error: "Product delete returned no deletedProductId" };
      }
      return {
        deleted: {
          productId: payload.deletedProductId as string,
          title: productTitle || "Product",
        },
      };
    } catch (err) {
      console.error("[deleteProduct]", err);
      return {
        error: err instanceof Error ? err.message : "Failed to delete product",
      };
    }
  }

  return { error: `Unknown intent: ${intent}` };
};

const fieldStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 560,
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 8,
  fontSize: 14,
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: 4,
  fontSize: 13,
};

export default function Index() {
  const {
    products,
    health,
    analyses,
    jobs,
    filter,
    page,
    catalogPageInfo,
    jobsPaused,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  const [title, setTitle] = useState("Blue Cotton T-Shirt");
  const [description, setDescription] = useState(
    "Soft cotton tee. Listing color is Blue — use a photo of a different color to test mismatch.",
  );
  const [productType, setProductType] = useState("Apparel");
  const [color, setColor] = useState("Blue");
  const [imageUrl, setImageUrl] = useState("");
  const [listingAttrs, setListingAttrs] = useState<ListingAttributeDraft>(
    EMPTY_LISTING_ATTRIBUTES,
  );
  const [pendingDelete, setPendingDelete] = useState<{
    productId: string;
    productTitle: string;
  } | null>(null);
  const lastRedirectedIdRef = useRef<string | null>(null);
  const handledFetcherDataRef = useRef<typeof fetcher.data>(undefined);

  const isSeeding =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "seedDemoB";
  const isCreating =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "createTestProduct";
  const isDeleting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "deleteProduct";
  const isBulkScanning =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulkScan";
  const deletingProductId = isDeleting
    ? String(fetcher.formData?.get("productId") || "")
    : null;

  useEffect(() => {
    if (!fetcher.data || fetcher.data === handledFetcherDataRef.current) {
      return;
    }
    handledFetcherDataRef.current = fetcher.data;

    if ("seeded" in fetcher.data && fetcher.data.seeded) {
      const id = fetcher.data.seeded.numericId;
      shopify.toast.show("Demo Product B created — opening Guardian…");
      revalidator.revalidate();
      if (lastRedirectedIdRef.current !== id) {
        lastRedirectedIdRef.current = id;
        navigate(`/app/guardian/${id}`);
      }
    }
    if ("created" in fetcher.data && fetcher.data.created) {
      const id = fetcher.data.created.numericId;
      shopify.toast.show(
        `Created: ${fetcher.data.created.title}. Analysis queued — continue working.`,
      );
      revalidator.revalidate();
      if (lastRedirectedIdRef.current !== id) {
        lastRedirectedIdRef.current = id;
        navigate(`/app/guardian/${id}`);
      }
    }
    if ("deleted" in fetcher.data && fetcher.data.deleted) {
      shopify.toast.show(`Deleted: ${fetcher.data.deleted.title}`);
      queueMicrotask(() => setPendingDelete(null));
      revalidator.revalidate();
    }
    if ("bulkScan" in fetcher.data && fetcher.data.bulkScan) {
      shopify.toast.show(
        `Queued ${fetcher.data.bulkScan.queued} scans (${fetcher.data.bulkScan.deduped} already queued). Results appear in Inbox when ready.`,
      );
      revalidator.revalidate();
    }
    if ("retried" in fetcher.data && fetcher.data.retried != null) {
      shopify.toast.show(`Retried ${fetcher.data.retried} failed scans`);
      revalidator.revalidate();
    }
    if ("demoCatalog" in fetcher.data && fetcher.data.demoCatalog) {
      const n = fetcher.data.demoCatalog.created.length;
      shopify.toast.show(
        `Demo catalog: ${n} products created (explicitly labeled DEMO DATA)`,
      );
      revalidator.revalidate();
    }
    if ("experimentalSeed" in fetcher.data && fetcher.data.experimentalSeed) {
      const s = fetcher.data.experimentalSeed;
      const errNote =
        s.errors?.length > 0 ? ` (${s.errors.length} warnings)` : "";
      shopify.toast.show(
        `Filled ${s.metafieldsWritten} category attributes on ${s.productsTouched} products${errNote}. Queued ${s.scansQueued ?? 0} re-scans.`,
      );
      revalidator.revalidate();
    }
    if ("cancelledJobs" in fetcher.data && fetcher.data.cancelledJobs != null) {
      shopify.toast.show(`Cancelled ${fetcher.data.cancelledJobs} queued scans`);
      revalidator.revalidate();
    }
    if ("jobsPaused" in fetcher.data && fetcher.data.jobsPaused != null) {
      shopify.toast.show(
        fetcher.data.jobsPaused ? "Scan queue paused" : "Scan queue resumed",
      );
      revalidator.revalidate();
    }
    if ("error" in fetcher.data && fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify, revalidator, navigate]);

  const deleteProduct = (productId: string, productTitle: string) => {
    if (isDeleting) return;
    setPendingDelete({ productId, productTitle });
  };

  const confirmDelete = () => {
    if (!pendingDelete || isDeleting) return;
    fetcher.submit(
      {
        intent: "deleteProduct",
        productId: pendingDelete.productId,
        productTitle: pendingDelete.productTitle,
      },
      { method: "POST" },
    );
  };

  const created =
    fetcher.data && "created" in fetcher.data ? fetcher.data.created : null;
  const seeded =
    fetcher.data && "seeded" in fetcher.data ? fetcher.data.seeded : null;

  const queueBulkScan = () => {
    const ids = products.map((p: { id: string }) => p.id).join(",");
    fetcher.submit({ intent: "bulkScan", productIds: ids }, { method: "POST" });
  };

  const setFilter = (next: string) => {
    navigate(`/app?filter=${encodeURIComponent(next)}&page=1`);
  };

  const confidenceBand = (score: number) =>
    score >= 0.85 ? "High" : score >= 0.55 ? "Medium" : "Low";

  const primaryIssue = (issuesJson: string): string => {
    try {
      const issues = JSON.parse(issuesJson) as Array<{
        signal: string;
        verdict: string;
      }>;
      const mismatch = issues.find((i) => i.verdict === "MISMATCH");
      if (mismatch) {
        if (mismatch.signal === "productType") return "Product type";
        return mismatch.signal.charAt(0).toUpperCase() + mismatch.signal.slice(1);
      }
      const uncertain = issues.find((i) => i.verdict === "UNCERTAIN");
      if (uncertain) return uncertain.signal;
    } catch {
      /* ignore */
    }
    return "—";
  };

  const attrLines = Object.entries(health.byAttribute).sort(
    (a, b) => b[1] - a[1],
  );

  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const doneJobs = jobs.filter((j) => j.status === "done").length;

  return (
    <s-page heading="Catalog Health">
      <s-section heading="What needs my attention?">
        <s-stack direction="block" gap="large">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              {health.needsAttention > 0
                ? `${health.needsAttention} listing${health.needsAttention === 1 ? "" : "s"} need attention`
                : health.totalScanned === 0
                  ? "No catalog has been scanned yet. Scan your catalog to find visual listing issues."
                  : "Your catalog looks healthy. No verified mismatches found."}
            </s-paragraph>

            {attrLines.length > 0 ? (
              <s-stack direction="inline" gap="small">
                {attrLines.map(([attr, count]) => (
                  <s-badge key={attr} tone="critical">
                    {count} {attr === "productType" ? "Product type" : attr}{" "}
                    mismatch{count === 1 ? "" : "es"}
                  </s-badge>
                ))}
              </s-stack>
            ) : null}
          </s-stack>

          <s-stack direction="inline" gap="small">
            <s-badge>{health.totalScanned} scanned</s-badge>
            <s-badge tone="critical">
              {health.needsAttention} need attention
            </s-badge>
            <s-badge tone="caution">{health.uncertain} uncertain</s-badge>
            <s-badge tone="success">{health.healthy} healthy</s-badge>
            <s-badge>{health.recentlyFixed} fixed (7d)</s-badge>
          </s-stack>

          {activeJobs > 0 ? (
            <s-banner tone="info" heading="Scanning in progress">
              <s-paragraph>
                Scanning {doneJobs} / {doneJobs + activeJobs + failedJobs}{" "}
                products ({activeJobs} in queue). You can keep working — results
                appear here when each scan finishes.
              </s-paragraph>
            </s-banner>
          ) : null}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              variant="primary"
              onClick={queueBulkScan}
              disabled={isBulkScanning}
              {...(isBulkScanning ? { loading: true } : {})}
            >
              {isBulkScanning ? "Queueing…" : "Scan catalog"}
            </s-button>
            <s-button
              onClick={() =>
                fetcher.submit({ intent: "retryFailedJobs" }, { method: "POST" })
              }
              disabled={failedJobs === 0 || isBulkScanning}
            >
              Retry failed scans
            </s-button>
            <s-link href="/app/settings">Settings</s-link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Needs attention">
        <s-stack direction="block" gap="large">
          <s-stack direction="inline" gap="small">
            <s-button
              {...(filter === "attention" ? { variant: "primary" } : {})}
              onClick={() => setFilter("attention")}
            >
              Needs attention
            </s-button>
            <s-button
              {...(filter === "uncertain" ? { variant: "primary" } : {})}
              onClick={() => setFilter("uncertain")}
            >
              Uncertain
            </s-button>
            <s-button
              {...(filter === "healthy" ? { variant: "primary" } : {})}
              onClick={() => setFilter("healthy")}
            >
              Healthy
            </s-button>
            <s-button
              {...(filter === "all" ? { variant: "primary" } : {})}
              onClick={() => setFilter("all")}
            >
              All
            </s-button>
          </s-stack>

          {analyses.length === 0 ? (
            health.totalScanned === 0 ? (
              <s-banner tone="info" heading="No analyses yet">
                <s-paragraph>
                  Scan your catalog to find listing issues, or open Guardian on
                  a single product. Results stay here — we never re-analyze just
                  to paint this page.
                </s-paragraph>
              </s-banner>
            ) : filter === "attention" && health.needsAttention === 0 ? (
              <s-banner tone="success" heading="Your catalog looks healthy">
                <s-paragraph>
                  No verified mismatches found. Check Uncertain if you want to
                  review inconclusive listings.
                </s-paragraph>
              </s-banner>
            ) : (
              <s-paragraph>
                Nothing in this view yet. Try another filter or scan more
                products.
              </s-paragraph>
            )
          ) : (
            <s-stack direction="block" gap="base">
              {analyses.map((row) => {
                const numericId =
                  row.productId.split("/").pop() ?? row.productId;
                const issue = primaryIssue(row.issuesJson);
                const band = confidenceBand(row.overallConfidence);
                const statusLabel =
                  row.verdict === "MISMATCH"
                    ? "Mismatch"
                    : row.verdict === "UNCERTAIN"
                      ? "Uncertain"
                      : row.verdict === "MATCH"
                        ? "Healthy"
                        : row.verdict;
                const statusTone =
                  row.verdict === "MISMATCH"
                    ? ("critical" as const)
                    : row.verdict === "UNCERTAIN"
                      ? ("caution" as const)
                      : row.verdict === "MATCH"
                        ? ("success" as const)
                        : undefined;
                return (
                  <s-box
                    key={row.id}
                    padding="large"
                    borderWidth="base"
                    borderRadius="large"
                    background="base"
                    inlineSize="100%"
                  >
                    <s-stack
                      direction="inline"
                      gap="large"
                      alignItems="center"
                      justifyContent="space-between"
                      inlineSize="100%"
                    >
                      <s-stack direction="block" gap="small">
                        <s-text type="strong">
                          {row.productTitle || row.productId}
                        </s-text>
                        <s-stack direction="inline" gap="small">
                          <s-badge {...(statusTone ? { tone: statusTone } : {})}>
                            {statusLabel}
                          </s-badge>
                          {issue !== "—" ? (
                            <s-badge>{issue}</s-badge>
                          ) : null}
                          <s-badge>{band} confidence</s-badge>
                        </s-stack>
                      </s-stack>
                      <s-button
                        variant="primary"
                        onClick={() =>
                          navigate(`/app/guardian/${numericId}`)
                        }
                      >
                        Review
                      </s-button>
                    </s-stack>
                  </s-box>
                );
              })}
              {analyses.length >= 25 ? (
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="center"
                >
                  <s-button
                    disabled={page <= 1}
                    onClick={() =>
                      navigate(
                        `/app?filter=${encodeURIComponent(filter)}&page=${page - 1}`,
                      )
                    }
                  >
                    Previous
                  </s-button>
                  <s-text>Page {page}</s-text>
                  <s-button
                    onClick={() =>
                      navigate(
                        `/app?filter=${encodeURIComponent(filter)}&page=${page + 1}`,
                      )
                    }
                  >
                    Next
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {jobs.length > 0 || jobsPaused ? (
        <s-section heading="Scan jobs">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge>{activeJobs} active</s-badge>
              <s-badge {...(failedJobs > 0 ? { tone: "critical" as const } : {})}>
                {failedJobs} failed
              </s-badge>
              <s-badge tone="success">{doneJobs} done</s-badge>
              {jobsPaused ? (
                <s-badge tone="caution">Paused</s-badge>
              ) : null}
            </s-stack>
            <s-stack direction="inline" gap="base">
              {jobsPaused ? (
                <s-button
                  onClick={() =>
                    fetcher.submit({ intent: "resumeJobs" }, { method: "POST" })
                  }
                >
                  Resume scans
                </s-button>
              ) : (
                <s-button
                  onClick={() =>
                    fetcher.submit({ intent: "pauseJobs" }, { method: "POST" })
                  }
                  disabled={activeJobs === 0}
                >
                  Pause queue
                </s-button>
              )}
              <s-button
                tone="critical"
                onClick={() =>
                  fetcher.submit({ intent: "cancelAllJobs" }, { method: "POST" })
                }
                disabled={activeJobs === 0}
              >
                Cancel queued
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Products">
        <s-paragraph>
          Newest Shopify products (paginated). Open Guardian to review a single
          listing — Catalog Health above is the primary inbox.
        </s-paragraph>
        {products.length === 0 ? (
          <s-banner tone="info" heading="No products found">
            Use Demo tools below to seed example products, or create a product
            in Shopify Admin.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map(
              (product: {
                id: string;
                numericId: string;
                title: string;
                description: string;
                productType: string | null;
                color: string | null;
                imageUrl: string | null;
              }) => (
                <s-box
                  key={product.id}
                  padding="large"
                  borderWidth="base"
                  borderRadius="large"
                  background="base"
                  inlineSize="100%"
                >
                  <s-stack
                    direction="inline"
                    gap="large"
                    alignItems="start"
                    justifyContent="space-between"
                    inlineSize="100%"
                  >
                    <s-stack direction="inline" gap="base" alignItems="start">
                      {product.imageUrl ? (
                        <s-thumbnail
                          src={product.imageUrl}
                          alt={product.title}
                          size="small"
                        />
                      ) : null}
                      <s-stack direction="block" gap="small">
                        <s-heading>{product.title}</s-heading>
                        <s-stack direction="inline" gap="small">
                          <s-badge>
                            Color: {product.color ?? "—"}
                          </s-badge>
                          <s-badge>
                            Type: {product.productType || "—"}
                          </s-badge>
                        </s-stack>
                        {product.description ? (
                          <s-paragraph>
                            {product.description.length > 140
                              ? `${product.description.slice(0, 140)}…`
                              : product.description}
                          </s-paragraph>
                        ) : null}
                      </s-stack>
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      <s-button
                        variant="primary"
                        href={`/app/guardian/${product.numericId}`}
                      >
                        Open Guardian
                      </s-button>
                      <s-button
                        tone="critical"
                        onClick={() =>
                          deleteProduct(product.id, product.title)
                        }
                        disabled={isDeleting}
                        {...(deletingProductId === product.id
                          ? { loading: true }
                          : {})}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-box>
              ),
            )}
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="center"
            >
              {catalogPageInfo.cursor ? (
                <s-button
                  onClick={() =>
                    navigate(
                      `/app?filter=${encodeURIComponent(filter)}&page=${page}`,
                    )
                  }
                >
                  Newest
                </s-button>
              ) : null}
              {catalogPageInfo.hasNextPage && catalogPageInfo.endCursor ? (
                <s-button
                  onClick={() =>
                    navigate(
                      `/app?filter=${encodeURIComponent(filter)}&page=${page}&catalogCursor=${encodeURIComponent(catalogPageInfo.endCursor!)}`,
                    )
                  }
                >
                  Next products
                </s-button>
              ) : null}
            </s-stack>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Demo tools">
        <s-banner tone="info" heading="Demo data">
          <s-paragraph>
            These actions create explicitly labeled demo products for testing.
            They are not merchant catalog data and titles are prefixed with
            [Demo]. Use “Fill category attributes” to backfill sleeve,
            neckline, closure, shoe style, strap, pattern, and finish on
            existing products.
          </s-paragraph>
        </s-banner>
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={() =>
              fetcher.submit({ intent: "seedDemoCatalog" }, { method: "POST" })
            }
          >
            Seed demo catalog
          </s-button>
          <s-button
            onClick={() =>
              fetcher.submit(
                { intent: "seedExperimentalAttrs" },
                { method: "POST" },
              )
            }
          >
            Fill category attributes
          </s-button>
          <s-button
            onClick={() =>
              fetcher.submit({ intent: "seedDemoB" }, { method: "POST" })
            }
            {...(isSeeding ? { loading: true } : {})}
          >
            Create Demo Product B (golden path)
          </s-button>
        </s-stack>
        {seeded && (
          <s-banner tone="success" heading="Product B seeded">
            <s-paragraph>
              Created {seeded.productId}. Option Color={seeded.color}.
              {seeded.mediaWarning ? ` Media note: ${seeded.mediaWarning}` : ""}{" "}
              {seeded.note}
            </s-paragraph>
            <s-button
              variant="primary"
              href={`/app/guardian/${seeded.numericId}`}
            >
              Open Guardian
            </s-button>
          </s-banner>
        )}
      </s-section>

      <s-section heading="Create test product">
        <s-paragraph>
          Set the claims you care about (color, type, and optional attributes).
          Skip or clear any attribute that doesn’t fit this product, then create
          — Guardian compares the photo only to the claims you saved.
        </s-paragraph>
        <fetcher.Form
          method="POST"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const claims = listingAttributesForSubmit(listingAttrs, productType);
            fetcher.submit(
              {
                intent: "createTestProduct",
                title,
                description,
                productType,
                color,
                imageUrl,
                material: claims.material,
                pattern: claims.pattern,
                finish: claims.finish,
                sleeveType: claims.sleeveType,
                neckline: claims.neckline,
                closureType: claims.closureType,
                shoeStyle: claims.shoeStyle,
                strapType: claims.strapType,
              },
              { method: "POST" },
            );
          }}
        >
          <s-stack direction="block" gap="base">
            <label style={labelStyle}>
              Title
              <input
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Navy Leather Backpack"
                required
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              Description
              <textarea
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Product description shown on the Shopify listing"
                rows={4}
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </label>
            <s-stack direction="inline" gap="base">
              <label style={labelStyle}>
                Product type
                <input
                  name="productType"
                  value={productType}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setProductType(nextType);
                    setListingAttrs((prev) =>
                      pruneListingAttributesForProductType(prev, nextType),
                    );
                  }}
                  placeholder="Wallet, Shoe, Bag, Apparel…"
                  style={{ ...fieldStyle, maxWidth: 240 }}
                />
              </label>
              <label style={labelStyle}>
                Color option
                <input
                  name="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Blue, Red, Green…"
                  required
                  style={{ ...fieldStyle, maxWidth: 200 }}
                />
              </label>
            </s-stack>

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-heading>Listing attributes (claims before AI)</s-heading>
                <s-paragraph>
                  Every field is optional. Leave as “Skip” or clear it if it
                  doesn’t apply to this product — only filled values are saved.
                  Changing product type removes attributes that no longer fit.
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  {listingAttributeFieldsForProductType(productType).map(
                    (field) => (
                      <div key={field.key} style={{ minWidth: 200 }}>
                        <label style={labelStyle}>
                          {field.label}
                          <s-stack direction="inline" gap="small">
                            <select
                              name={field.key}
                              value={listingAttrs[field.key]}
                              onChange={(e) =>
                                setListingAttrs((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }))
                              }
                              style={{ ...fieldStyle, maxWidth: 180 }}
                            >
                              <option value="">Skip — not set</option>
                              {field.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <s-button
                              type="button"
                              {...(listingAttrs[field.key]
                                ? {}
                                : { disabled: true })}
                              onClick={() =>
                                setListingAttrs((prev) => ({
                                  ...prev,
                                  [field.key]: "",
                                }))
                              }
                            >
                              Clear
                            </s-button>
                          </s-stack>
                        </label>
                      </div>
                    ),
                  )}
                </s-stack>
                <s-button
                  type="button"
                  onClick={() => setListingAttrs(EMPTY_LISTING_ATTRIBUTES)}
                >
                  Clear all attributes
                </s-button>
              </s-stack>
            </s-box>

            <label style={labelStyle}>
              Image URL (optional, must be publicly reachable)
              <input
                name="imageUrl"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://… (leave blank to add photo later in Admin)"
                style={fieldStyle}
              />
            </label>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                type="submit"
                {...(isCreating ? { loading: true } : {})}
              >
                Create product in Shopify
              </s-button>
              <s-button
                type="button"
                onClick={() => {
                  setTitle("Blue Cotton T-Shirt");
                  setDescription(
                    "Soft cotton tee. Listing color is Blue — use a photo of a different color to test mismatch.",
                  );
                  setProductType("Apparel");
                  setColor("Blue");
                  setImageUrl("");
                  setListingAttrs(apparelListingDefaults());
                }}
              >
                Prefill Blue apparel
              </s-button>
              <s-button
                type="button"
                onClick={() => {
                  setTitle("Green Plastic Water Bottle");
                  setDescription(
                    "Insulated bottle. Listed as Green — attach a blue bottle photo to test color mismatch.",
                  );
                  setProductType("Bottle");
                  setColor("Green");
                  setImageUrl("");
                  setListingAttrs(bottleListingDefaults());
                }}
              >
                Prefill Green bottle
              </s-button>
              <s-button
                type="button"
                onClick={() => {
                  setTitle("Brown Leather Handbag");
                  setDescription(
                    "Full-grain leather handbag. Listed Color Brown.",
                  );
                  setProductType("Handbag");
                  setColor("Brown");
                  setImageUrl("");
                  setListingAttrs(handbagListingDefaults());
                }}
              >
                Prefill Brown handbag
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>

        {created && (
          <s-banner tone="success" heading="Test product created">
            <s-paragraph>
              {created.title} · Color={created.color} · Type=
              {created.productType || "—"}.
              {"claims" in created && created.claims
                ? ` ${created.claims}.`
                : ""}{" "}
              {created.note}
              {created.mediaWarning
                ? ` Media note: ${created.mediaWarning}`
                : ""}
            </s-paragraph>
            <s-button
              variant="primary"
              href={`/app/guardian/${created.numericId}`}
            >
              Open Guardian
            </s-button>
          </s-banner>
        )}
      </s-section>

      {pendingDelete && (
        <DeleteConfirmModal
          open={Boolean(pendingDelete)}
          productTitle={pendingDelete.productTitle}
          loading={isDeleting}
          onCancel={() => {
            if (isDeleting) return;
            setPendingDelete(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
