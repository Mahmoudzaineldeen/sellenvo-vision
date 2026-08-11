import { useEffect, useMemo, useState } from "react";
import type { FixableSignal, SuggestedFix } from "../lib/types";
import { MATERIAL_KEYWORDS } from "../lib/materials";
import { PATTERN_KEYWORDS } from "../lib/attributes/normalize/pattern";
import { FINISH_KEYWORDS } from "../lib/attributes/normalize/finish";

const MODAL_ID = "fix-confirmation-modal";

type ModalElement = HTMLElement & {
  showOverlay?: () => void;
  hideOverlay?: () => void;
};

export type MaterialWriteMode = "metafield" | "title" | "both";

function fieldLabel(
  field: FixableSignal,
  materialWriteMode: MaterialWriteMode = "metafield",
): string {
  if (field === "productType") return "Product type";
  if (field === "material") {
    if (materialWriteMode === "title") return "Material (product title)";
    if (materialWriteMode === "both") return "Material (metafield + title)";
    return "Material (metafield)";
  }
  if (field === "pattern") return "Pattern";
  if (field === "finish") return "Finish";
  return "Color";
}

function materialStorageExplanation(mode: MaterialWriteMode): string {
  if (mode === "title") {
    return "This will rewrite the material word in your product title.";
  }
  if (mode === "both") {
    return "This will update the sellenvo.material metafield and rewrite the material word in your product title.";
  }
  return "This will update the sellenvo.material metafield only. Your product title will not change.";
}

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

function swatchFor(name: string): string | null {
  return COLOR_SWATCHES[name.toLowerCase().trim()] ?? null;
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
  materialWriteMode?: MaterialWriteMode;
  onCancel: () => void;
  /** For applyAll, receives selected fixes. For edit, receives the edited value. */
  onConfirm: (value?: string, selectedFixes?: SuggestedFix[]) => void;
}

function BeforeAfterRow({
  field,
  currentValue,
  proposedValue,
  materialWriteMode,
}: {
  field: FixableSignal;
  currentValue: string;
  proposedValue: string;
  materialWriteMode: MaterialWriteMode;
}) {
  const currentSwatch = field === "color" ? swatchFor(currentValue) : null;
  const proposedSwatch = field === "color" ? swatchFor(proposedValue) : null;

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="base">
        <s-text type="strong">{fieldLabel(field, materialWriteMode)}</s-text>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
              Current
            </div>
            <s-stack direction="inline" gap="small">
              {currentSwatch && (
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: currentSwatch,
                    border: "1px solid #ccc",
                    display: "inline-block",
                  }}
                />
              )}
              <s-text type="strong">{currentValue || "—"}</s-text>
            </s-stack>
          </div>
          <s-text>→</s-text>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
              Proposed
            </div>
            <s-stack direction="inline" gap="small">
              {proposedSwatch && (
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: proposedSwatch,
                    border: "1px solid #ccc",
                    display: "inline-block",
                  }}
                />
              )}
              <s-text type="strong">{proposedValue || "—"}</s-text>
            </s-stack>
          </div>
        </div>
        {field === "material" && (
          <s-text>{materialStorageExplanation(materialWriteMode)}</s-text>
        )}
      </s-stack>
    </s-box>
  );
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
  materialWriteMode = "metafield",
  onCancel,
  onConfirm,
}: FixModalProps) {
  const [editValue, setEditValue] = useState(suggestedValue);
  const [seedOpen, setSeedOpen] = useState(open);
  const [seedSuggested, setSeedSuggested] = useState(suggestedValue);
  const [selectedFields, setSelectedFields] = useState<Set<FixableSignal>>(
    () => new Set(fixes.map((f) => f.field)),
  );

  if (open !== seedOpen || suggestedValue !== seedSuggested) {
    setSeedOpen(open);
    setSeedSuggested(suggestedValue);
    if (open) {
      setEditValue(suggestedValue);
      setSelectedFields(new Set(fixes.map((f) => f.field)));
    }
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

  const selectedFixes = useMemo(
    () => fixes.filter((f) => selectedFields.has(f.field)),
    [fixes, selectedFields],
  );

  const heading =
    mode === "applyAll"
      ? `Review ${fixes.length} change${fixes.length === 1 ? "" : "s"}`
      : mode === "edit"
        ? `Edit ${field ? fieldLabel(field, materialWriteMode) : "value"}`
        : "Confirm correction";

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
        : field === "pattern"
          ? Array.from(
              new Set(
                [
                  suggestedValue,
                  currentValue,
                  ...PATTERN_KEYWORDS.map(
                    (p) => p.charAt(0).toUpperCase() + p.slice(1),
                  ),
                ].filter(Boolean),
              ),
            )
          : field === "finish"
            ? Array.from(
                new Set(
                  [
                    suggestedValue,
                    currentValue,
                    ...FINISH_KEYWORDS.map(
                      (f) => f.charAt(0).toUpperCase() + f.slice(1),
                    ),
                  ].filter(Boolean),
                ),
              )
            : Array.from(
                new Set(
                  [suggestedValue, currentValue, ...COMMON_TYPES].filter(
                    Boolean,
                  ),
                ),
              );

  const toggleField = (f: FixableSignal) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const primaryDisabled =
    !!loading ||
    (mode === "edit" && !editValue.trim()) ||
    (mode === "applyAll" && selectedFixes.length === 0);

  return (
    <s-modal id={MODAL_ID} heading={heading} onHide={onCancel}>
      <s-stack direction="block" gap="base">
        {mode === "applyAll" && (
          <>
            <s-paragraph>
              Select which listing changes to apply. Each change is verified in
              Shopify independently.
            </s-paragraph>
            {fixes.map((fix) => {
              const checked = selectedFields.has(fix.field);
              const label = fieldLabel(fix.field, materialWriteMode);
              return (
                <div key={fix.field}>
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="inline" gap="base">
                      <input
                        type="checkbox"
                        id={`apply-all-${fix.field}`}
                        checked={checked}
                        disabled={!!loading}
                        onChange={() => toggleField(fix.field)}
                        aria-label={`Include ${label}`}
                      />
                      <div style={{ flex: 1 }}>
                        <BeforeAfterRow
                          field={fix.field}
                          currentValue={fix.currentValue}
                          proposedValue={fix.suggestedValue}
                          materialWriteMode={materialWriteMode}
                        />
                      </div>
                    </s-stack>
                  </s-box>
                </div>
              );
            })}
            <s-banner tone="warning">
              Updates run as one batch. Successful changes are kept if a later
              fix fails.
            </s-banner>
          </>
        )}

        {mode === "confirm" && field && (
          <>
            <s-paragraph>
              Review the change before updating your Shopify listing:
            </s-paragraph>
            <BeforeAfterRow
              field={field}
              currentValue={currentValue}
              proposedValue={suggestedValue}
              materialWriteMode={materialWriteMode}
            />
            <s-banner tone="warning">
              This updates the actual Shopify product. You can revert from
              mutation history if needed.
            </s-banner>
          </>
        )}

        {mode === "edit" && field && (
          <>
            <s-paragraph>
              Current value: <s-text type="strong">{currentValue}</s-text>
            </s-paragraph>
            {field === "material" && (
              <s-banner tone="info">
                {materialStorageExplanation(materialWriteMode)}
              </s-banner>
            )}
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
              aria-label={`New ${fieldLabel(field, materialWriteMode)}`}
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
        onClick={() => {
          if (mode === "applyAll") {
            onConfirm(undefined, selectedFixes);
            return;
          }
          onConfirm(mode === "edit" ? editValue.trim() : undefined);
        }}
        disabled={primaryDisabled}
        {...(loading ? { loading: true } : {})}
      >
        {mode === "applyAll"
          ? `Apply ${selectedFixes.length} selected`
          : mode === "edit"
            ? "Save"
            : "Confirm fix"}
      </s-button>
    </s-modal>
  );
}

export { useFixModal } from "./useFixModal";
