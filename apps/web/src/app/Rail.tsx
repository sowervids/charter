import { useState } from "react";
import {
  Hash,
  Kanban,
  Landmark,
  Plug,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useStore } from "../lib/store.js";
import { Avatar } from "./Avatar.js";
import { Dialog } from "./Dialog.js";

export function Rail() {
  const { state, openChannel, navigate, createChannel } = useStore();
  const [newChannel, setNewChannel] = useState(false);
  const view = state.view;

  const liveAgents = new Set(
    Object.values(state.runs)
      .filter((r) => r.status === "running" || r.status === "queued")
      .map((r) => r.agentId),
  );
  const agents = state.roster.filter((r) => r.kind === "agent");
  const humans = state.roster.filter((r) => r.kind === "human");
  const reviewCount = state.tasks.filter((t) => t.status === "review").length;

  return (
    <nav aria-label="Company navigation" className="flex w-60 shrink-0 flex-col bg-bg-1">
      <div className="flex items-center gap-2 border-b border-line-1 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-serif text-[15px] font-semibold leading-6">
            {state.company?.name ?? "—"}
          </div>
          <div className="tnum font-mono text-[11px] text-text-3">
            {state.lastSeq} events on record
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("charter:palette"))}
        className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-line-1 bg-bg-2 px-2.5 py-1.5 text-left text-text-3 transition-colors duration-(--motion-fast) hover:border-line-2 hover:text-text-2"
      >
        <Search size={14} strokeWidth={1.5} />
        <span className="flex-1 text-[12px]">Search…</span>
        <kbd className="font-mono text-[10px] text-text-3">⌘K</kbd>
      </button>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          <NavItem icon={Kanban} label="Board" active={view.kind === "board"} onClick={() => navigate({ kind: "board" })} badge={reviewCount || undefined} />
          <NavItem icon={ShieldCheck} label="Approvals" active={view.kind === "approvals"} onClick={() => navigate({ kind: "approvals" })} badge={state.approvalsPending || undefined} badgeTone="accent" />
          <NavItem icon={Landmark} label="Treasury" active={view.kind === "treasury"} onClick={() => navigate({ kind: "treasury" })} />
          <NavItem icon={Users} label="People & Agents" active={view.kind === "people" || view.kind === "agent"} onClick={() => navigate({ kind: "people" })} />
          <NavItem icon={Plug} label="Connections" active={view.kind === "connections"} onClick={() => navigate({ kind: "connections" })} />
        </div>

        <Section
          label="Channels"
          action={
            <button
              type="button"
              onClick={() => setNewChannel(true)}
              aria-label="New channel"
              className="flex h-5 w-5 items-center justify-center rounded-sm text-text-3 hover:bg-bg-2 hover:text-text-1"
            >
              <Plus size={13} strokeWidth={1.75} />
            </button>
          }
        >
          {state.channels.map((c) => (
            <RailRow
              key={c.channel_id}
              active={view.kind === "channel" && view.channelId === c.channel_id}
              onClick={() => openChannel(c.channel_id)}
            >
              <Hash size={14} strokeWidth={1.5} className={view.kind === "channel" && view.channelId === c.channel_id ? "text-text-2" : "text-text-3"} />
              <span className="truncate text-[13px]">{c.name}</span>
            </RailRow>
          ))}
        </Section>

        <Section label="People">
          {[...humans, ...agents].map((m) => (
            <RailRow
              key={m.id}
              active={view.kind === "agent" && view.agentId === m.id}
              onClick={() => (m.kind === "agent" ? navigate({ kind: "agent", agentId: m.id }) : undefined)}
            >
              <Avatar id={m.id} name={m.name} kind={m.kind} size={18} live={liveAgents.has(m.id)} />
              <span className="truncate text-[13px]">{m.kind === "agent" ? `@${m.id}` : m.name}</span>
              {m.paused && <span className="ml-auto font-mono text-[9px] uppercase text-warn">paused</span>}
            </RailRow>
          ))}
        </Section>
      </div>

      <div className="border-t border-line-1 px-2 py-2">
        <div className="flex items-center gap-2 px-2 py-1">
          <Avatar id="founder" name="Founder" kind="human" size={22} />
          <span className="flex-1 truncate text-[12px] text-text-2">Founder</span>
          <button
            type="button"
            onClick={() => navigate({ kind: "log" })}
            aria-label="Event log"
            title="Event log"
            className={`flex h-6 w-6 items-center justify-center rounded-sm ${view.kind === "log" ? "text-accent" : "text-text-3 hover:bg-bg-2 hover:text-text-2"}`}
          >
            <ScrollText size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {newChannel && (
        <NewChannelDialog
          onClose={() => setNewChannel(false)}
          onCreate={async (name, topic) => {
            const id = await createChannel(name, topic);
            if (id) setNewChannel(false);
          }}
        />
      )}
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
  badgeTone,
}: {
  icon: typeof Kanban;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeTone?: "accent" | "warn";
}) {
  return (
    <RailRow active={active} onClick={onClick}>
      <Icon size={15} strokeWidth={1.5} className={active ? "text-text-2" : "text-text-3"} />
      <span className="text-[13px]">{label}</span>
      {badge !== undefined && (
        <span
          className={`tnum ml-auto rounded-sm px-1 font-mono text-[10px] font-medium ${
            badgeTone === "accent" ? "bg-accent text-accent-ink" : "bg-bg-3 text-text-2"
          }`}
        >
          {badge}
        </span>
      )}
    </RailRow>
  );
}

function RailRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-8 w-full items-center gap-2 rounded-sm pl-2.5 pr-2 text-left transition-colors duration-(--motion-fast) ${
        active ? "bg-bg-2 text-text-1" : "text-text-2 hover:bg-bg-2/60 hover:text-text-1"
      }`}
    >
      {active && <span className="absolute left-0 top-1.5 h-5 w-0.5 rounded-full bg-accent" />}
      {children}
    </button>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="flex items-center px-2 pb-1">
        <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
          {label}
        </span>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NewChannelDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, topic?: string) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  return (
    <Dialog title="New channel" onClose={onClose} onSubmit={() => name.trim() && onCreate(name, topic || undefined)} submitLabel="Create" submitDisabled={name.trim().length === 0}>
      <Field label="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="growth"
          className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3"
        />
        <p className="mt-1 font-mono text-[10px] text-text-3">becomes #{slug(name) || "…"}</p>
      </Field>
      <Field label="Topic (optional)">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What this channel is for"
          className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[12px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3"
        />
      </Field>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{label}</div>
      {children}
    </div>
  );
}

function slug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
