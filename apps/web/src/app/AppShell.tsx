import { useEffect } from "react";
import { useStore } from "../lib/store.js";
import { ApprovalsView } from "./ApprovalsView.js";
import { BoardView } from "./BoardView.js";
import { ChannelView } from "./ChannelView.js";
import { ConnectionsView } from "./ConnectionsView.js";
import { LogView } from "./LogView.js";
import { Palette } from "./Palette.js";
import { PeopleView, AgentDetailView } from "./PeopleView.js";
import { Rail } from "./Rail.js";
import { ToastHost } from "./ToastHost.js";
import { TraceView } from "./TraceView.js";
import { TreasuryView } from "./TreasuryView.js";

export function AppShell() {
  const { state } = useStore();
  const view = state.view;

  useEffect(() => {
    document.title = state.company ? `${state.company.name} — Keelson` : "Keelson";
  }, [state.company]);

  return (
    <div className="flex h-full bg-bg-0 text-text-1">
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col border-l border-line-1 bg-bg-0">
        {view.kind === "channel" && <ChannelView channelId={view.channelId} />}
        {view.kind === "board" && <BoardView taskId={view.taskId} />}
        {view.kind === "approvals" && <ApprovalsView />}
        {view.kind === "treasury" && <TreasuryView />}
        {view.kind === "people" && <PeopleView />}
        {view.kind === "agent" && <AgentDetailView agentId={view.agentId} />}
        {view.kind === "connections" && <ConnectionsView />}
        {view.kind === "trace" && <TraceView runId={view.runId} />}
        {view.kind === "log" && <LogView />}
      </main>
      <Palette />
      <ToastHost />
      {state.connection === "reconnecting" && (
        <div className="fixed inset-x-0 top-0 z-50 h-0.5 bg-warn" aria-live="polite" />
      )}
    </div>
  );
}
