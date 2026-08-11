import { useEffect } from "react";

const MODAL_ID = "delete-product-modal";

type ModalElement = HTMLElement & {
  showOverlay?: () => void;
  hideOverlay?: () => void;
};

interface DeleteConfirmModalProps {
  open: boolean;
  productTitle: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Destructive confirmation for permanent product deletion.
 * Uses Polaris web component s-modal (showOverlay / hideOverlay API).
 */
export function DeleteConfirmModal({
  open,
  productTitle,
  loading,
  onCancel,
  onConfirm,
}: DeleteConfirmModalProps) {
  useEffect(() => {
    const el = document.getElementById(MODAL_ID) as ModalElement | null;
    if (!el) return;
    if (open) {
      el.showOverlay?.();
    } else {
      el.hideOverlay?.();
    }
  }, [open]);

  return (
    <s-modal
      id={MODAL_ID}
      heading="Delete product permanently?"
      onHide={onCancel}
    >
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Delete <s-text type="strong">{productTitle}</s-text> from Shopify?
        </s-paragraph>
        <s-banner tone="critical">
          This cannot be undone. The product and its media will be permanently
          removed from your store.
        </s-banner>
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
        tone="critical"
        onClick={onConfirm}
        disabled={!!loading}
        {...(loading ? { loading: true } : {})}
      >
        Delete permanently
      </s-button>
    </s-modal>
  );
}
