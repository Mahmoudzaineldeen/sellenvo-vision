import { useCallback, useMemo, useState } from "react";

export function useFixModal() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return useMemo(
    () => ({ open, show, hide, setOpen }),
    [open, show, hide],
  );
}
