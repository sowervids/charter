import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { useStore } from "../lib/store.js";
import type { RosterEntry } from "../lib/api.js";
import { Avatar } from "./Avatar.js";

interface MentionState {
  open: boolean;
  query: string;
  start: number; // index of the '@'
  active: number;
}

const CLOSED: MentionState = { open: false, query: "", start: -1, active: 0 };

export function Composer({ channelId }: { channelId: string }) {
  const { state, sendMessage } = useStore();
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<MentionState>(CLOSED);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const channel = state.channels.find((c) => c.channel_id === channelId);

  const matches: RosterEntry[] = mention.open
    ? state.roster
        .filter(
          (r) =>
            r.id.startsWith(mention.query.toLowerCase()) ||
            r.name.toLowerCase().startsWith(mention.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        el?.tagName !== "TEXTAREA" &&
        el?.tagName !== "INPUT"
      ) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Grow the textarea to fit its content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  function detectMention(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = /(?:^|\s)@([a-z0-9-]*)$/i.exec(before);
    if (m && m.index !== undefined) {
      const at = before.lastIndexOf("@");
      setMention({ open: true, query: m[1] ?? "", start: at, active: 0 });
    } else {
      setMention(CLOSED);
    }
  }

  function insertMention(entry: RosterEntry) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${entry.id} ${value.slice(caret)}`;
    setValue(next);
    setMention(CLOSED);
    requestAnimationFrame(() => {
      const pos = mention.start + entry.id.length + 2;
      el?.setSelectionRange(pos, pos);
      el?.focus();
    });
  }

  const submit = () => {
    const body = value.trim();
    if (body.length === 0) return;
    setValue("");
    setMention(CLOSED);
    void sendMessage(channelId, body);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => ({ ...m, active: (m.active + 1) % matches.length }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => ({ ...m, active: (m.active - 1 + matches.length) % matches.length }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(matches[mention.active] ?? matches[0]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(CLOSED);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative shrink-0 px-4 pb-4 pt-1">
      {mention.open && matches.length > 0 && (
        <div className="animate-pop absolute bottom-[calc(100%-4px)] left-4 z-20 w-72 overflow-hidden rounded-lg border border-line-2 bg-bg-3 py-1 shadow-[var(--shadow-3)]">
          <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
            Mention
          </div>
          {matches.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(entry);
              }}
              onMouseEnter={() => setMention((m) => ({ ...m, active: i }))}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                i === mention.active ? "bg-bg-2" : ""
              }`}
            >
              <Avatar id={entry.id} name={entry.name} kind={entry.kind} size={22} />
              <span className="text-[13px] text-text-1">@{entry.id}</span>
              <span className="truncate text-[11px] text-text-3">{entry.role}</span>
              {entry.paused && (
                <span className="ml-auto font-mono text-[9px] uppercase text-warn">paused</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-lg border border-line-1 bg-bg-2 px-3 py-2 transition-colors duration-(--motion-fast) has-[textarea:focus]:border-accent-dim has-[textarea:focus]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_12%,transparent)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            detectMention(e.target.value, e.target.selectionStart ?? 0);
          }}
          onKeyUp={(e) => detectMention(value, e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => detectMention(value, e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(CLOSED), 120)}
          rows={1}
          placeholder={`Message #${channel?.name ?? channelId} — @mention an agent to put it to work`}
          aria-label={`Message #${channel?.name ?? channelId}`}
          className="max-h-44 min-h-[22px] flex-1 resize-none bg-transparent text-[14px] leading-[21px] text-text-1 outline-none placeholder:text-text-3"
        />
        <div className="flex items-center gap-1.5 pb-0.5">
          <span className="hidden select-none font-mono text-[10px] text-text-3 sm:inline">
            ⏎ send
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={value.trim().length === 0}
            aria-label="Send"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 transition-colors duration-(--motion-fast) enabled:text-accent enabled:hover:bg-bg-3 disabled:opacity-30"
          >
            <CornerDownLeft size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
