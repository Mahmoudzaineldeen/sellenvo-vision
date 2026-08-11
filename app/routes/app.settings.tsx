import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  upsertShopSettings,
  type MaterialWriteMode,
} from "../lib/shop-settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const materialWriteMode = String(
    formData.get("materialWriteMode") || "metafield",
  ) as MaterialWriteMode;
  const autoScanOnCreate = formData.get("autoScanOnCreate") === "on";
  const safeAutoFixEnabled = formData.get("safeAutoFixEnabled") === "on";
  const showExperimentalAttributes =
    formData.get("showExperimentalAttributes") === "on";

  const settings = await upsertShopSettings(session.shop, {
    materialWriteMode,
    autoScanOnCreate,
    safeAutoFixEnabled,
    showExperimentalAttributes,
  });
  return { settings, saved: true };
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const handled = useRef<typeof fetcher.data>(undefined);

  useEffect(() => {
    if (!fetcher.data || fetcher.data === handled.current) return;
    handled.current = fetcher.data;
    if ("saved" in fetcher.data && fetcher.data.saved) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const current =
    fetcher.data && "settings" in fetcher.data
      ? fetcher.data.settings
      : settings;

  return (
    <s-page heading="Catalog Integrity Settings">
      <s-section heading="Material storage">
        <s-paragraph>
          Default is metafield-first (`sellenvo.material`). Title rewriting is
          never silent — enable it only when you explicitly want title updates.
        </s-paragraph>
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <label>
              Material write mode{" "}
              <select
                name="materialWriteMode"
                defaultValue={current.materialWriteMode}
              >
                <option value="metafield">Metafield only (recommended)</option>
                <option value="title">Title only</option>
                <option value="both">Metafield + title</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                name="autoScanOnCreate"
                defaultChecked={current.autoScanOnCreate}
              />{" "}
              Auto-scan products on create
            </label>
            <label>
              <input
                type="checkbox"
                name="safeAutoFixEnabled"
                defaultChecked={current.safeAutoFixEnabled}
              />{" "}
              Enable safe auto-fix (off by default)
            </label>
            <label>
              <input
                type="checkbox"
                name="showExperimentalAttributes"
                defaultChecked={current.showExperimentalAttributes}
              />{" "}
              Show experimental attributes (pattern, finish)
            </label>
            <s-button type="submit" variant="primary">
              Save settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
