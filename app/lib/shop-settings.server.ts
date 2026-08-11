import db from "../db.server";
import type { ShopFixSettings } from "./attributes";

export type MaterialWriteMode = "metafield" | "title" | "both";

export type ShopSettingsRecord = {
  shop: string;
  materialWriteMode: MaterialWriteMode;
  autoScanOnCreate: boolean;
  safeAutoFixEnabled: boolean;
  showExperimentalAttributes: boolean;
};

const DEFAULTS: Omit<ShopSettingsRecord, "shop"> = {
  materialWriteMode: "metafield",
  autoScanOnCreate: true,
  safeAutoFixEnabled: false,
  /** Pilot default ON so Guardian surfaces category attributes without a Settings trip. */
  showExperimentalAttributes: true,
};

function normalizeMode(raw: string): MaterialWriteMode {
  if (raw === "title" || raw === "both" || raw === "metafield") return raw;
  return "metafield";
}

export async function getShopSettings(shop: string): Promise<ShopSettingsRecord> {
  const row = await db.shopSettings.findUnique({ where: { shop } });
  if (!row) {
    return { shop, ...DEFAULTS };
  }
  return {
    shop: row.shop,
    materialWriteMode: normalizeMode(row.materialWriteMode),
    autoScanOnCreate: row.autoScanOnCreate,
    safeAutoFixEnabled: row.safeAutoFixEnabled,
    showExperimentalAttributes: row.showExperimentalAttributes,
  };
}

export async function upsertShopSettings(
  shop: string,
  patch: Partial<Omit<ShopSettingsRecord, "shop">>,
): Promise<ShopSettingsRecord> {
  const current = await getShopSettings(shop);
  const next = {
    materialWriteMode: patch.materialWriteMode
      ? normalizeMode(patch.materialWriteMode)
      : current.materialWriteMode,
    autoScanOnCreate:
      patch.autoScanOnCreate ?? current.autoScanOnCreate,
    safeAutoFixEnabled:
      patch.safeAutoFixEnabled ?? current.safeAutoFixEnabled,
    showExperimentalAttributes:
      patch.showExperimentalAttributes ?? current.showExperimentalAttributes,
  };
  await db.shopSettings.upsert({
    where: { shop },
    create: { shop, ...next },
    update: next,
  });
  return { shop, ...next };
}

export function toFixSettings(settings: ShopSettingsRecord): ShopFixSettings {
  return {
    safeAutoFixEnabled: settings.safeAutoFixEnabled,
    materialWriteMode: settings.materialWriteMode,
    showExperimentalAttributes: settings.showExperimentalAttributes,
  };
}

/** Pure gate used by products/create webhook — unit-testable. */
export function shouldAutoScanOnCreate(
  settings: Pick<ShopSettingsRecord, "autoScanOnCreate">,
): boolean {
  return settings.autoScanOnCreate === true;
}
