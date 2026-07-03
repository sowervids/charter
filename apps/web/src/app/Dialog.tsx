import { useEffect } from "react";

/** A centered modal. Esc closes; Cmd/Ctrl+Enter submits. Scrim fades,
 *  panel pops in (motion tokens). */
export function Dialog({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel = "Save",
  submitDisabled = false,
  width = 480,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit && !submitDisabled) {
        onSubmit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onSubmit, submitDisabled]);

  return (
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-start justify-center bg-bg-0/70 pt-[16vh]"
      onClick={onClose}
    >
      <div
        className="animate-pop rounded-lg border border-line-2 bg-bg-3 shadow-[var(--shadow-3)]"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line-1 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-text-1">{title}</h2>
        </div>
        <div className="px-4 py-4">{children}</div>
        {onSubmit && (
          <div className="flex items-center justify-end gap-2 border-t border-line-1 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm px-3 py-1.5 text-[12px] text-text-2 hover:text-text-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitDisabled}
              className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition-opacity duration-(--motion-fast) disabled:opacity-40"
            >
              {submitLabel}
              <span className="ml-1.5 font-mono text-[10px] opacity-60">⌘⏎</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
