import { useEffect } from "react";
import { useStore } from "../lib/store.js";

/** Bottom-center toasts. Auto-dismiss after 6s; optional Undo action. */
export function ToastHost() {
  const { state, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2">
      {state.toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
      ))}
    </div>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: import("../lib/store.js").Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const dot =
    toast.tone === "danger"
      ? "var(--color-danger)"
      : toast.tone === "ok"
        ? "var(--color-ok)"
        : "var(--color-text-3)";

  return (
    <div className="animate-pop pointer-events-auto flex items-center gap-3 rounded-md border border-line-2 bg-bg-3 py-2 pl-3 pr-2 shadow-[var(--shadow-2)]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      <span className="text-[12px] text-text-1">{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            onDismiss();
          }}
          className="rounded-sm px-2 py-0.5 text-[12px] font-medium text-accent hover:bg-bg-2"
        >
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded-sm px-1.5 py-0.5 text-text-3 hover:text-text-1"
      >
        ×
      </button>
    </div>
  );
}
