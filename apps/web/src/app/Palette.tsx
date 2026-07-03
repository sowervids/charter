import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Hash, Kanban, ScrollText } from "lucide-react";
import { useStore } from "../lib/store.js";

/**
 * Cmd+K — every user-facing action registers here in the same PR that adds
 * it (UI rule 6). Phase 1 actions: navigation.
 */
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

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed left-1/2 top-[20vh] z-50 w-[560px] -translate-x-1/2 overflow-hidden rounded-lg border border-line-2 bg-bg-3 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
    >
      <Command.Input
        placeholder="Go to…"
        className="w-full border-b border-line-1 bg-transparent px-4 py-3 text-[14px] text-text-1 outline-none placeholder:text-text-3"
      />
      <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-[12px] text-text-3">
          Nothing on record for that.
        </Command.Empty>
        <Command.Group
          heading="Channels"
          className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-text-3"
        >
          {state.channels.map((channel) => (
            <Item
              key={channel.channel_id}
              onSelect={() => run(() => openChannel(channel.channel_id))}
            >
              <Hash size={14} strokeWidth={1.5} className="text-text-3" />
              {channel.name}
            </Item>
          ))}
        </Command.Group>
        <Command.Group
          heading="Company"
          className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-text-3"
        >
          <Item onSelect={() => run(() => navigate({ kind: "board" }))}>
            <Kanban size={14} strokeWidth={1.5} className="text-text-3" />
            Board
          </Item>
          <Item onSelect={() => run(() => navigate({ kind: "log" }))}>
            <ScrollText size={14} strokeWidth={1.5} className="text-text-3" />
            Event log
            <span className="tnum ml-auto font-mono text-[10px] text-text-3">
              #{state.lastSeq}
            </span>
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] text-text-2 data-[selected=true]:bg-bg-2 data-[selected=true]:text-text-1"
    >
      {children}
    </Command.Item>
  );
}
