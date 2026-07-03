import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Bot, Hash, Kanban, Landmark, Plug, ScrollText, ShieldCheck, SquareKanban, Users } from "lucide-react";
import { useStore } from "../lib/store.js";

/** Cmd+K — navigate anywhere and jump to any task or agent. */
export function Palette() {
  const { state, openChannel, navigate } = useStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("charter:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("charter:palette", onOpen);
    };
  }, []);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  const agents = state.roster.filter((r) => r.kind === "agent");

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="animate-pop fixed left-1/2 top-[18vh] z-50 w-[580px] -translate-x-1/2 overflow-hidden rounded-lg border border-line-2 bg-bg-3 shadow-[var(--shadow-3)]"
    >
      <Command.Input
        placeholder="Search channels, tasks, agents, screens…"
        className="w-full border-b border-line-1 bg-transparent px-4 py-3 text-[14px] text-text-1 outline-none placeholder:text-text-3"
      />
      <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-[12px] text-text-3">Nothing on record for that.</Command.Empty>

        <Group heading="Go to">
          <Item onSelect={() => run(() => navigate({ kind: "board" }))}><Kanban size={14} strokeWidth={1.5} className="text-text-3" /> Board</Item>
          <Item onSelect={() => run(() => navigate({ kind: "approvals" }))}><ShieldCheck size={14} strokeWidth={1.5} className="text-text-3" /> Approvals {state.approvalsPending > 0 && <span className="tnum ml-auto font-mono text-[10px] text-accent">{state.approvalsPending}</span>}</Item>
          <Item onSelect={() => run(() => navigate({ kind: "treasury" }))}><Landmark size={14} strokeWidth={1.5} className="text-text-3" /> Treasury</Item>
          <Item onSelect={() => run(() => navigate({ kind: "people" }))}><Users size={14} strokeWidth={1.5} className="text-text-3" /> People &amp; Agents</Item>
          <Item onSelect={() => run(() => navigate({ kind: "connections" }))}><Plug size={14} strokeWidth={1.5} className="text-text-3" /> Connections</Item>
          <Item onSelect={() => run(() => navigate({ kind: "log" }))}><ScrollText size={14} strokeWidth={1.5} className="text-text-3" /> Event log <span className="tnum ml-auto font-mono text-[10px] text-text-3">#{state.lastSeq}</span></Item>
        </Group>

        <Group heading="Channels">
          {state.channels.map((c) => (
            <Item key={c.channel_id} onSelect={() => run(() => openChannel(c.channel_id))}>
              <Hash size={14} strokeWidth={1.5} className="text-text-3" /> {c.name}
            </Item>
          ))}
        </Group>

        {agents.length > 0 && (
          <Group heading="Agents">
            {agents.map((a) => (
              <Item key={a.id} value={`agent ${a.id} ${a.name} ${a.role}`} onSelect={() => run(() => navigate({ kind: "agent", agentId: a.id }))}>
                <Bot size={14} strokeWidth={1.5} className="text-text-3" /> @{a.id}
                <span className="ml-1 text-text-3">{a.role}</span>
              </Item>
            ))}
          </Group>
        )}

        {state.tasks.length > 0 && (
          <Group heading="Tasks">
            {state.tasks.slice(0, 40).map((t) => (
              <Item key={t.task_id} value={`task CH-${t.task_num} ${t.title}`} onSelect={() => run(() => navigate({ kind: "board", taskId: t.task_id }))}>
                <SquareKanban size={14} strokeWidth={1.5} className="text-text-3" />
                <span className="tnum font-mono text-[11px] text-text-3">CH-{t.task_num}</span> {t.title}
                <span className="ml-auto font-mono text-[10px] text-text-3">{t.status}</span>
              </Item>
            ))}
          </Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-text-3"
    >
      {children}
    </Command.Group>
  );
}

function Item({ children, onSelect, value }: { children: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      {...(value ? { value } : {})}
      className="flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] text-text-2 data-[selected=true]:bg-bg-2 data-[selected=true]:text-text-1"
    >
      {children}
    </Command.Item>
  );
}
