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

/**
 * Prefer a clearly black wallet when available. Wikimedia may be blocked from
 * Shopify media fetchers — merchant can replace the image in Admin after seed.
 */
const DEMO_BLACK_IMAGE =
  process.env.DEMO_BLACK_WALLET_IMAGE_URL || DEMO_BLACK_WALLET_IMAGE_URL;

const LIST_PRODUCTS_QUERY = `#graphql
  query GuardianListProducts {
    products(first: 50, sortKey: UPDATED_AT, reverse: true) {
      edges {
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
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(LIST_PRODUCTS_QUERY);
  const json = await response.json();
  const edges = json.data?.products?.edges ?? [];

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

  return { products };
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
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

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

  if (intent === "createTestProduct") {
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const productType = String(formData.get("productType") || "").trim();
    const color = String(formData.get("color") || "").trim();
    const imageUrl = String(formData.get("imageUrl") || "").trim();

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
          note: imageUrl
            ? "Product created. If the image is still processing, wait a few seconds then open Guardian."
            : "Product created without an image. Add a product photo in Shopify Admin or paste an image URL next time.",
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
  const { products } = useLoaderData<typeof loader>();
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
      shopify.toast.show(`Created: ${fetcher.data.created.title} — analyzing…`);
      revalidator.revalidate();
      if (lastRedirectedIdRef.current !== id) {
        lastRedirectedIdRef.current = id;
        navigate(`/app/guardian/${id}`);
      }
    }
    if ("deleted" in fetcher.data && fetcher.data.deleted) {
      shopify.toast.show(`Deleted: ${fetcher.data.deleted.title}`);
      setPendingDelete(null);
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

  return (
    <s-page heading="Visual Listing Guardian">
      <s-section heading="Sellenvo Vision">
        <s-paragraph>
          Create any test product below, or use Demo Product B for the classic
          Red listing + black wallet mismatch. Guardian opens automatically and
          starts analysis.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={() =>
              fetcher.submit({ intent: "seedDemoB" }, { method: "POST" })
            }
            {...(isSeeding ? { loading: true } : {})}
          >
            Create Demo Product B
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
          Fill any fields to build a real Shopify product for manual testing.
          Put material words in the title (leather, cotton, metal, …) so the
          Guardian can extract claimed material. Color becomes the Color option.
        </s-paragraph>
        <fetcher.Form
          method="POST"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            fetcher.submit(
              {
                intent: "createTestProduct",
                title,
                description,
                productType,
                color,
                imageUrl,
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
                  onChange={(e) => setProductType(e.target.value)}
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
                  setTitle("Green Plastic Water Bottle");
                  setDescription(
                    "Insulated bottle. Listed as Green — attach a blue bottle photo to test color mismatch.",
                  );
                  setProductType("Bottle");
                  setColor("Green");
                  setImageUrl("");
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
              {created.productType || "—"}. {created.note}
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

      <s-section heading="Products">
        {products.length === 0 ? (
          <s-banner tone="info" heading="No products found">
            Create a custom test product above, or click &quot;Create Demo
            Product B&quot;.
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
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="inline" gap="base">
                    {product.imageUrl ? (
                      <s-thumbnail
                        src={product.imageUrl}
                        alt={product.title}
                        size="small"
                      />
                    ) : null}
                    <s-stack direction="block" gap="small">
                      <s-heading>{product.title}</s-heading>
                      <s-paragraph>
                        Color: {product.color ?? "—"} · Type:{" "}
                        {product.productType || "—"}
                      </s-paragraph>
                      {product.description ? (
                        <s-paragraph>
                          {product.description.length > 140
                            ? `${product.description.slice(0, 140)}…`
                            : product.description}
                        </s-paragraph>
                      ) : null}
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
                  </s-stack>
                </s-box>
              ),
            )}
          </s-stack>
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
