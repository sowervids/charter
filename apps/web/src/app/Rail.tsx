import { Hash, Kanban, Landmark, ScrollText, Search, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store.js";

export function Rail() {
  const { state, openChannel, navigate } = useStore();
  const activeChannel =
    state.view.kind === "channel" ? state.view.channelId : null;

  return (
    <nav
      aria-label="Company navigation"
      className="flex w-60 shrink-0 flex-col bg-bg-1"
    >
      <div className="border-b border-line-1 px-4 py-3">
        <div className="font-serif text-[15px] font-semibold leading-6">
          {state.company?.name ?? "—"}
        </div>
        <div className="tnum font-mono text-[11px] text-text-3">
          {state.lastSeq} events on record
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("charter:palette"))
        }
        className="mx-3 mt-3 flex items-center gap-2 rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-left text-text-3 transition-colors duration-(--motion-fast) hover:border-line-2 hover:text-text-2"
      >
        <Search size={14} strokeWidth={1.5} />
        <span className="flex-1 text-[12px]">Search</span>
        <kbd className="font-mono text-[10px] text-text-3">⌘K</kbd>
      </button>

      <div className="mt-3 px-2">
        <button
          type="button"
          onClick={() => navigate({ kind: "board" })}
          aria-current={state.view.kind === "board" ? "page" : undefined}
          className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-(--motion-fast) ${
            state.view.kind === "board"
              ? "bg-bg-3 text-text-1"
              : "text-text-2 hover:bg-bg-2 hover:text-text-1"
          }`}
        >
          <Kanban
            size={14}
            strokeWidth={1.5}
            className={state.view.kind === "board" ? "text-accent" : "text-text-3"}
          />
          <span className="text-[13px]">Board</span>
          {state.tasks.filter((t) => t.status === "review").length > 0 && (
            <span className="tnum ml-auto rounded-sm bg-warn/20 px-1 font-mono text-[10px] text-warn">
              {state.tasks.filter((t) => t.status === "review").length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => navigate({ kind: "approvals" })}
          aria-current={state.view.kind === "approvals" ? "page" : undefined}
          className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-(--motion-fast) ${
            state.view.kind === "approvals"
              ? "bg-bg-3 text-text-1"
              : "text-text-2 hover:bg-bg-2 hover:text-text-1"
          }`}
        >
          <ShieldCheck
            size={14}
            strokeWidth={1.5}
            className={
              state.view.kind === "approvals" ? "text-accent" : "text-text-3"
            }
          />
          <span className="text-[13px]">Approvals</span>
          {state.approvalsPending > 0 && (
            <span className="tnum ml-auto rounded-sm bg-accent px-1 font-mono text-[10px] font-medium text-accent-ink">
              {state.approvalsPending}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => navigate({ kind: "treasury" })}
          aria-current={state.view.kind === "treasury" ? "page" : undefined}
          className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-(--motion-fast) ${
            state.view.kind === "treasury"
              ? "bg-bg-3 text-text-1"
              : "text-text-2 hover:bg-bg-2 hover:text-text-1"
          }`}
        >
          <Landmark
            size={14}
            strokeWidth={1.5}
            className={
              state.view.kind === "treasury" ? "text-accent" : "text-text-3"
            }
          />
          <span className="text-[13px]">Treasury</span>
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-2">
        <SectionLabel>Channels</SectionLabel>
        <ul>
          {state.channels.map((channel) => {
            const active = channel.channel_id === activeChannel;
            return (
              <li key={channel.channel_id}>
                <button
                  type="button"
                  onClick={() => openChannel(channel.channel_id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-(--motion-fast) ${
                    active
                      ? "bg-bg-3 text-text-1"
                      : "text-text-2 hover:bg-bg-2 hover:text-text-1"
                  }`}
                >
                  <Hash
                    size={14}
                    strokeWidth={1.5}
                    className={active ? "text-accent" : "text-text-3"}
                  />
                  <span className="truncate text-[13px]">{channel.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line-1 px-2 py-2">
        <button
          type="button"
          onClick={() => navigate({ kind: "log" })}
          aria-current={state.view.kind === "log" ? "page" : undefined}
          className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-(--motion-fast) ${
            state.view.kind === "log"
              ? "bg-bg-3 text-text-1"
              : "text-text-3 hover:bg-bg-2 hover:text-text-2"
          }`}
        >
          <ScrollText size={14} strokeWidth={1.5} />
          <span className="text-[12px]">Log</span>
          <span className="tnum ml-auto font-mono text-[10px]">
            #{state.lastSeq}
          </span>
        </button>
      </div>
    </nav>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
      {children}
    </div>
  );
}
