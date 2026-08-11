import { useEffect, useState } from "react";
import type { FixableSignal, SuggestedFix } from "../lib/types";
import { MATERIAL_KEYWORDS } from "../lib/materials";

const MODAL_ID = "fix-confirmation-modal";

type ModalElement = HTMLElement & {
  showOverlay?: () => void;
  hideOverlay?: () => void;
};

function fieldLabel(field: FixableSignal): string {
  if (field === "productType") return "Product type";
  if (field === "material") return "Material (in product title)";
  return "Color option";
}

const COMMON_COLORS = [
  "Black",
  "White",
  "Red",
  "Blue",
  "Green",
  "Yellow",
  "Orange",
  "Purple",
  "Pink",
  "Brown",
  "Grey",
  "Navy",
  "Beige",
  "Gold",
  "Silver",
  "Maroon",
  "Teal",
];

const COMMON_TYPES = [
  "Apparel",
  "Shoe",
  "Wallet",
  "Bag",
  "Handbag",
  "Watch",
  "Bottle",
  "Jacket",
  "Hoodie",
  "T-Shirt",
];

type ModalMode = "confirm" | "edit" | "applyAll";

interface FixModalProps {
  open: boolean;
  mode: ModalMode;
  field?: FixableSignal;
  currentValue?: string;
  suggestedValue?: string;
  fixes?: SuggestedFix[];
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (value?: string) => void;
}

/**
 * Confirmation / edit / apply-all modal for Shopify listing fixes.
 * Uses Polaris web component s-modal (showOverlay / hideOverlay API).
 */
export function FixModal({
  open,
  mode,
  field,
  currentValue = "",
  suggestedValue = "",
  fixes = [],
  loading,
  onCancel,
  onConfirm,
}: FixModalProps) {
  const [editValue, setEditValue] = useState(suggestedValue);
  const [seedOpen, setSeedOpen] = useState(open);
  const [seedSuggested, setSeedSuggested] = useState(suggestedValue);

  if (open !== seedOpen || suggestedValue !== seedSuggested) {
    setSeedOpen(open);
    setSeedSuggested(suggestedValue);
    if (open) setEditValue(suggestedValue);
  }

  useEffect(() => {
    const el = document.getElementById(MODAL_ID) as ModalElement | null;
    if (!el) return;
    if (open) {
      el.showOverlay?.();
    } else {
      el.hideOverlay?.();
    }
  }, [open]);

  const heading =
    mode === "applyAll"
      ? `Apply ${fixes.length} fixes?`
      : mode === "edit"
        ? `Edit ${field ? fieldLabel(field) : "value"}`
        : "Confirm Correction";

  const options =
    field === "color"
      ? Array.from(
          new Set(
            [suggestedValue, currentValue, ...COMMON_COLORS].filter(Boolean),
          ),
        )
      : field === "material"
        ? Array.from(
            new Set(
              [
                suggestedValue,
                currentValue,
                ...MATERIAL_KEYWORDS.map(
                  (m) => m.charAt(0).toUpperCase() + m.slice(1),
                ),
              ].filter(Boolean),
            ),
          )
        : Array.from(
            new Set(
              [suggestedValue, currentValue, ...COMMON_TYPES].filter(Boolean),
            ),
          );

  return (
    <s-modal id={MODAL_ID} heading={heading} onHide={onCancel}>
      <s-stack direction="block" gap="base">
        {mode === "applyAll" && (
          <>
            <s-paragraph>
              These changes will update the real Shopify product:
            </s-paragraph>
            {fixes.map((fix) => (
              <s-box
                key={fix.field}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="base">
                  <s-text type="strong">{fieldLabel(fix.field)}</s-text>
                  <s-text>
                    {fix.currentValue} → {fix.suggestedValue}
                  </s-text>
                </s-stack>
              </s-box>
            ))}
            <s-banner tone="warning">
              Updates run as one batch. Successful changes are kept if a later
              fix fails.
            </s-banner>
            {fixes.some((f) => f.field === "material") && (
              <s-banner tone="warning">
                Material fixes rewrite the product title (Shopify has no
                dedicated material field). Review the title after applying.
              </s-banner>
            )}
          </>
        )}

        {mode === "confirm" && field && (
          <>
            <s-paragraph>
              {fieldLabel(field)} will be updated on the real Shopify product:
            </s-paragraph>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="inline" gap="base">
                <s-text type="strong">{currentValue}</s-text>
                <s-text>→</s-text>
                <s-text type="strong">{suggestedValue}</s-text>
              </s-stack>
            </s-box>
            <s-banner tone="warning">
              This will update the actual Shopify product. You can change it
              back manually if needed.
            </s-banner>
            {field === "material" && (
              <s-banner tone="warning">
                This will update your product title by replacing the material
                word (Shopify has no dedicated material field).
              </s-banner>
            )}
          </>
        )}

        {mode === "edit" && field && (
          <>
            <s-paragraph>
              Current value: <s-text type="strong">{currentValue}</s-text>
            </s-paragraph>
            <label
              htmlFor="guardian-edit-value"
              style={{ display: "block", fontWeight: 600, fontSize: 13 }}
            >
              New value
            </label>
            <select
              id="guardian-edit-value"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              disabled={!!loading}
              style={{
                display: "block",
                width: "100%",
                maxWidth: 420,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 14,
              }}
            >
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <s-paragraph>Or type a custom value:</s-paragraph>
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              disabled={!!loading}
              aria-label={`New ${fieldLabel(field)}`}
              style={{
                display: "block",
                width: "100%",
                maxWidth: 420,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 14,
              }}
            />
            <s-banner tone="warning">
              Saving updates the real Shopify product, then re-checks listing
              consistency.
            </s-banner>
            {field === "material" && (
              <s-banner tone="warning">
                Saving rewrites the material word in your product title.
              </s-banner>
            )}
          </>
        )}
      </s-stack>

      <s-button
        slot="secondary-actions"
        onClick={onCancel}
        disabled={!!loading}
      >
        Cancel
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() =>
          onConfirm(mode === "edit" ? editValue.trim() : undefined)
        }
        disabled={mode === "edit" && !editValue.trim()}
        {...(loading ? { loading: true } : {})}
      >
        {mode === "applyAll"
          ? `Apply ${fixes.length} Fixes`
          : mode === "edit"
            ? "Save"
            : "Confirm Fix"}
      </s-button>
    </s-modal>
  );
}

export { useFixModal } from "./useFixModal";
