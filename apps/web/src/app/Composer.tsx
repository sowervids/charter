import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { useStore } from "../lib/store.js";

export function Composer({ channelId }: { channelId: string }) {
  const { state, sendMessage } = useStore();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const channel = state.channels.find((c) => c.channel_id === channelId);

  // `c` focuses the composer from anywhere (keyboard grammar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const body = value.trim();
    if (body.length === 0) return;
    setValue("");
    void sendMessage(channelId, body);
    textareaRef.current?.focus();
  };

  return (
    <div className="shrink-0 border-t border-line-1 bg-bg-0 px-6 py-3">
      <div className="flex items-end gap-2 rounded-md border border-line-1 bg-bg-2 px-3 py-2 transition-colors duration-(--motion-fast) focus-within:border-accent-dim">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={`Write to #${channel?.name ?? channelId} — it goes on the record`}
          aria-label={`Message #${channel?.name ?? channelId}`}
          className="max-h-40 min-h-[20px] flex-1 resize-none bg-transparent text-[14px] leading-5 text-text-1 outline-none placeholder:text-text-3"
        />
        <button
          type="button"
          onClick={submit}
          disabled={value.trim().length === 0}
          aria-label="Send"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 transition-colors duration-(--motion-fast) enabled:text-accent enabled:hover:bg-bg-3 disabled:opacity-40"
        >
          <CornerDownLeft size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
